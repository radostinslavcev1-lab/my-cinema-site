import os
import tempfile
import hmac
from functools import wraps
from datetime import datetime, timedelta

from flask import (
    Flask, render_template, request, redirect,
    url_for, flash, session, jsonify, abort
)
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

from database import db
from models import MediaItem, Episode
from streamtape import (
    extract_streamtape_id, upload_file_to_streamtape,
    check_api_status, StreamtapeAPIError
)

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# --- Configuration ---
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'cinema-super-secret-key-change-in-production-2026')

# Database URL configuration (Support both SQLite locally and PostgreSQL on Render/Heroku)
database_url = os.environ.get('DATABASE_URL')
if database_url:
    # Fix legacy postgres:// dialect prefix for SQLAlchemy 1.4+
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
else:
    # Local SQLite
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///cinema.db'

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Maximum upload file size: 5 GB for video files
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH_MB', 5000)) * 1024 * 1024
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

# Allowed video extensions
ALLOWED_EXTENSIONS = {'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'm4v'}

# Streamtape credentials
STREAMTAPE_LOGIN = os.environ.get('STREAMTAPE_LOGIN', '').strip()
STREAMTAPE_KEY = os.environ.get('STREAMTAPE_KEY', '').strip()

# Admin credentials
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin').strip()
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin123').strip()

# Initialize DB with App
db.init_app(app)

# Ensure temporary upload directory exists
TEMP_DIR = os.path.join(tempfile.gettempdir(), 'cinema_streamtape_uploads')
os.makedirs(TEMP_DIR, exist_ok=True)


def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('is_admin'):
            flash('Трябва да влезете в профила си, за да достъпите тази страница.', 'warning')
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function


@app.context_processor
def inject_global_data():
    """Provides common data to all Jinja templates."""
    # Collect unique genres from DB for navbar and filter dropdowns
    try:
        raw_genres = db.session.query(MediaItem.genre).distinct().all()
        genre_set = set()
        for g_row in raw_genres:
            if g_row[0]:
                for item in g_row[0].split(','):
                    cleaned = item.strip()
                    if cleaned:
                        genre_set.add(cleaned)
        genres_list = sorted(list(genre_set))
    except Exception:
        genres_list = []

    return {
        'is_admin': session.get('is_admin', False),
        'admin_user': session.get('admin_user', ''),
        'current_year': datetime.now().year,
        'all_genres': genres_list,
        'streamtape_configured': bool(STREAMTAPE_LOGIN and STREAMTAPE_KEY)
    }


# ==========================================
# PUBLIC CATALOG ROUTES
# ==========================================

@app.route('/')
def index():
    """Main Catalog Page: Movie/Series Grid with Search, Filters and Sorting."""
    search_query = request.args.get('q', '').strip()
    genre_filter = request.args.get('genre', '').strip()
    type_filter = request.args.get('type', '').strip().lower()  # 'movie' or 'series'
    sort_by = request.args.get('sort', 'newest').strip().lower()

    query = MediaItem.query

    # Apply search filter
    if search_query:
        search_pattern = f"%{search_query}%"
        query = query.filter(
            db.or_(
                MediaItem.title.ilike(search_pattern),
                MediaItem.description.ilike(search_pattern),
                MediaItem.genre.ilike(search_pattern)
            )
        )

    # Apply genre filter
    if genre_filter:
        query = query.filter(MediaItem.genre.ilike(f"%{genre_filter}%"))

    # Apply media type filter
    if type_filter in ['movie', 'series']:
        query = query.filter(MediaItem.media_type == type_filter)

    # Apply sorting
    if sort_by == 'rating':
        query = query.order_by(MediaItem.rating.desc().nullslast(), MediaItem.created_at.desc())
    elif sort_by == 'year':
        query = query.order_by(MediaItem.release_year.desc().nullslast(), MediaItem.created_at.desc())
    elif sort_by == 'title':
        query = query.order_by(MediaItem.title.asc())
    else:  # newest
        query = query.order_by(MediaItem.created_at.desc())

    items = query.all()

    # Pick a featured item for the hero section
    featured_item = None
    if not search_query and not genre_filter and not type_filter and items:
        # Choose the first item or the highest-rated item with a poster
        featured_candidates = [i for i in items if i.poster_url]
        featured_item = featured_candidates[0] if featured_candidates else items[0]

    return render_template(
        'index.html',
        items=items,
        featured_item=featured_item,
        current_search=search_query,
        current_genre=genre_filter,
        current_type=type_filter,
        current_sort=sort_by,
        total_results=len(items)
    )


@app.route('/watch/<int:id>')
def watch(id):
    """
    Video Player and Details Page.
    Renders the responsive Streamtape iframe, episode selector (for series),
    and similar recommendations.
    """
    item = MediaItem.query.get_or_404(id)

    current_episode = None
    active_streamtape_id = None

    if item.media_type == 'series':
        ep_id = request.args.get('ep', type=int)
        if ep_id:
            current_episode = Episode.query.filter_by(id=ep_id, media_id=item.id).first()

        # If no episode specified or invalid, default to the first available episode
        if not current_episode and item.episodes:
            current_episode = item.episodes[0]

        if current_episode:
            active_streamtape_id = current_episode.streamtape_id
        else:
            active_streamtape_id = item.streamtape_id
    else:
        # Movie
        active_streamtape_id = item.streamtape_id

    # Find similar titles based on shared genres or same type
    similar_items = []
    if item.genres_list:
        primary_genre = item.genres_list[0]
        similar_items = MediaItem.query.filter(
            MediaItem.id != item.id,
            MediaItem.genre.ilike(f"%{primary_genre}%")
        ).limit(6).all()

    if len(similar_items) < 6:
        # Fill with same media type
        additional = MediaItem.query.filter(
            MediaItem.id != item.id,
            MediaItem.media_type == item.media_type,
            ~MediaItem.id.in_([s.id for s in similar_items])
        ).limit(6 - len(similar_items)).all()
        similar_items.extend(additional)

    return render_template(
        'watch.html',
        item=item,
        current_episode=current_episode,
        active_streamtape_id=active_streamtape_id,
        similar_items=similar_items
    )


@app.route('/api/search')
def api_search():
    """Live search API for frontend autocomplete / instant lookup."""
    q = request.args.get('q', '').strip()
    if not q or len(q) < 2:
        return jsonify([])

    pattern = f"%{q}%"
    results = MediaItem.query.filter(
        db.or_(
            MediaItem.title.ilike(pattern),
            MediaItem.genre.ilike(pattern)
        )
    ).limit(8).all()

    return jsonify([
        {
            'id': item.id,
            'title': item.title,
            'release_year': item.release_year,
            'genre': item.genre,
            'rating': item.formatted_rating,
            'poster_url': item.safe_poster_url,
            'media_type': item.media_type,
            'url': url_for('watch', id=item.id)
        }
        for item in results
    ])


# ==========================================
# AUTHENTICATION ROUTES
# ==========================================

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Admin Login Page."""
    if session.get('is_admin'):
        return redirect(url_for('admin_dashboard'))

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()

        # Constant-time comparison to prevent timing attacks
        valid_user = hmac.compare_digest(username, ADMIN_USERNAME)
        valid_pass = hmac.compare_digest(password, ADMIN_PASSWORD)

        if valid_user and valid_pass:
            session.permanent = True
            session['is_admin'] = True
            session['admin_user'] = username
            flash('Добре дошли в административния панел!', 'success')
            next_url = request.args.get('next')
            return redirect(next_url or url_for('admin_dashboard'))
        else:
            flash('Грешно потребителско име или парола!', 'danger')

    return render_template('login.html')


@app.route('/logout')
def logout():
    """Admin Logout."""
    session.clear()
    flash('Успешно излязохте от администраторския профил.', 'info')
    return redirect(url_for('index'))


# ==========================================
# ADMIN MANAGEMENT ROUTES
# ==========================================

@app.route('/admin')
@login_required
def admin_dashboard():
    """
    Admin Management Dashboard:
    - Overview statistics
    - Streamtape API health status
    - Media items table
    """
    media_items = MediaItem.query.order_by(MediaItem.created_at.desc()).all()

    total_count = len(media_items)
    movie_count = sum(1 for m in media_items if m.media_type == 'movie')
    series_count = sum(1 for m in media_items if m.media_type == 'series')
    total_episodes = Episode.query.count()

    # Check Streamtape API status
    api_status = check_api_status(STREAMTAPE_LOGIN, STREAMTAPE_KEY)

    return render_template(
        'admin.html',
        items=media_items,
        total_count=total_count,
        movie_count=movie_count,
        series_count=series_count,
        total_episodes=total_episodes,
        api_status=api_status,
        current_streamtape_login=STREAMTAPE_LOGIN,
        current_streamtape_key=STREAMTAPE_KEY
    )


@app.route('/admin/settings/streamtape', methods=['POST'])
@login_required
def admin_settings_streamtape():
    """Allows updating Streamtape API credentials directly from the Admin Panel."""
    global STREAMTAPE_LOGIN, STREAMTAPE_KEY
    import re

    login_val = request.form.get('streamtape_login', '').strip()
    key_val = request.form.get('streamtape_key', '').strip()

    if not login_val or not key_val:
        flash('Моля, попълнете както API Login, така и API Key / Password!', 'warning')
        return redirect(url_for('admin_dashboard'))

    # Update in memory
    STREAMTAPE_LOGIN = login_val
    STREAMTAPE_KEY = key_val

    # Update in .env file
    env_file = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(env_file):
        try:
            with open(env_file, 'r', encoding='utf-8') as f:
                content = f.read()

            content = re.sub(r'STREAMTAPE_LOGIN=.*', f'STREAMTAPE_LOGIN={login_val}', content)
            content = re.sub(r'STREAMTAPE_KEY=.*', f'STREAMTAPE_KEY={key_val}', content)

            with open(env_file, 'w', encoding='utf-8') as f:
                f.write(content)
        except Exception as e:
            pass

    # Test status immediately
    status = check_api_status(STREAMTAPE_LOGIN, STREAMTAPE_KEY)
    if status.get('valid'):
        flash(f"Успешно свързване със Streamtape API! Акаунт: {status.get('email', 'Активен')}", 'success')
    else:
        flash(f"Ключовете са запазени, но Streamtape върна: {status.get('message')}", 'warning')

    return redirect(url_for('admin_dashboard'))


@app.route('/admin/add', methods=['POST'])
@login_required
def admin_add_media():
    """
    Unified route to add media content:
    - Method 1: Manual entry (pasted Streamtape link or ID)
    - Method 2: Automatic 2-step Streamtape API file upload
    """
    title = request.form.get('title', '').strip()
    if not title:
        flash('Заглавието е задължително!', 'danger')
        return redirect(url_for('admin_dashboard'))

    description = request.form.get('description', '').strip()
    genre = request.form.get('genre', '').strip()
    poster_url = request.form.get('poster_url', '').strip()
    media_type = request.form.get('media_type', 'movie').strip().lower()
    if media_type not in ['movie', 'series']:
        media_type = 'movie'

    # Safe parsing of year and rating
    try:
        release_year = int(request.form.get('release_year', '')) if request.form.get('release_year') else None
    except ValueError:
        release_year = None

    try:
        rating = float(request.form.get('rating', '')) if request.form.get('rating') else 7.0
    except ValueError:
        rating = 7.0

    upload_method = request.form.get('upload_method', 'manual')
    streamtape_id = None

    if upload_method == 'api_upload':
        # Method 2: Automatic upload to Streamtape API
        if 'video_file' not in request.files:
            flash('Не е избран видео файл за качване!', 'danger')
            return redirect(url_for('admin_dashboard'))

        file = request.files['video_file']
        if file.filename == '':
            flash('Не е избран видео файл!', 'danger')
            return redirect(url_for('admin_dashboard'))

        if not allowed_file(file.filename):
            allowed_str = ', '.join(ALLOWED_EXTENSIONS)
            flash(f'Невалиден формат на файла. Разрешени формати: {allowed_str}', 'danger')
            return redirect(url_for('admin_dashboard'))

        # Secure local save before streaming to Streamtape
        safe_name = secure_filename(file.filename)
        temp_path = os.path.join(TEMP_DIR, f"{int(datetime.now().timestamp())}_{safe_name}")

        try:
            file.save(temp_path)
            flash('Файлът е подготвен локално. Започва 2-стъпково качване към Streamtape API...', 'info')

            upload_result = upload_file_to_streamtape(
                file_path=temp_path,
                filename=safe_name,
                api_login=STREAMTAPE_LOGIN,
                api_key=STREAMTAPE_KEY
            )
            streamtape_id = upload_result.get('file_id')
            flash(f"Успешно качване в Streamtape! File ID: {streamtape_id}", 'success')

        except StreamtapeAPIError as e:
            flash(f"Грешка при Streamtape API: {str(e)}", 'danger')
            return redirect(url_for('admin_dashboard'))
        except Exception as e:
            flash(f"Неочаквана грешка при качване на видеото: {str(e)}", 'danger')
            return redirect(url_for('admin_dashboard'))
        finally:
            # Always clean up the temporary file
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
    else:
        # Method 1: Manual entry
        raw_streamtape_input = request.form.get('streamtape_id', '').strip()
        streamtape_id = extract_streamtape_id(raw_streamtape_input)

        if media_type == 'movie' and not streamtape_id:
            flash('За филм е необходимо да въведете валиден Streamtape ID или линк!', 'danger')
            return redirect(url_for('admin_dashboard'))

    # Create MediaItem record
    new_media = MediaItem(
        title=title,
        description=description,
        release_year=release_year,
        genre=genre,
        rating=rating,
        poster_url=poster_url,
        media_type=media_type,
        streamtape_id=streamtape_id if media_type == 'movie' else None
    )

    db.session.add(new_media)
    db.session.commit()

    # If it's a series and user provided an initial streamtape_id, add as Episode 1
    if media_type == 'series' and streamtape_id:
        ep1 = Episode(
            media_id=new_media.id,
            season_num=1,
            episode_num=1,
            title='Пилотен епизод',
            streamtape_id=streamtape_id
        )
        db.session.add(ep1)
        db.session.commit()

    flash(f"Заглавието „{new_media.title}“ беше успешно добавено!", 'success')

    # If it's a series, prompt to manage episodes
    if media_type == 'series':
        return redirect(url_for('admin_manage_episodes', media_id=new_media.id))

    return redirect(url_for('admin_dashboard'))


@app.route('/admin/edit/<int:id>', methods=['GET', 'POST'])
@login_required
def admin_edit_media(id):
    """Edit existing movie or series details."""
    item = MediaItem.query.get_or_404(id)

    if request.method == 'POST':
        item.title = request.form.get('title', '').strip() or item.title
        item.description = request.form.get('description', '').strip()
        item.genre = request.form.get('genre', '').strip()
        item.poster_url = request.form.get('poster_url', '').strip()

        # Update year
        try:
            item.release_year = int(request.form.get('release_year', '')) if request.form.get('release_year') else None
        except ValueError:
            pass

        # Update rating
        try:
            item.rating = float(request.form.get('rating', '')) if request.form.get('rating') else 7.0
        except ValueError:
            pass

        # Update streamtape ID for movies
        if item.media_type == 'movie':
            raw_id = request.form.get('streamtape_id', '').strip()
            item.streamtape_id = extract_streamtape_id(raw_id)

        db.session.commit()
        flash(f"Заглавието „{item.title}“ беше обновено успешно!", 'success')
        return redirect(url_for('admin_dashboard'))

    return render_template('admin_edit.html', item=item)


@app.route('/admin/delete/<int:id>', methods=['POST'])
@login_required
def admin_delete_media(id):
    """Deletes a media item and all associated episodes."""
    item = MediaItem.query.get_or_404(id)
    title = item.title
    db.session.delete(item)
    db.session.commit()
    flash(f"Заглавието „{title}“ и свързаните епизоди бяха изтрити.", 'info')
    return redirect(url_for('admin_dashboard'))


# ==========================================
# SERIES EPISODES MANAGEMENT
# ==========================================

@app.route('/admin/media/<int:media_id>/episodes')
@login_required
def admin_manage_episodes(media_id):
    """View and manage all episodes of a series."""
    media = MediaItem.query.get_or_404(media_id)
    if media.media_type != 'series':
        flash('Епизоди могат да се управляват само за сериали.', 'warning')
        return redirect(url_for('admin_dashboard'))

    return render_template('admin_episodes.html', media=media)


@app.route('/admin/media/<int:media_id>/episodes/add', methods=['POST'])
@login_required
def admin_add_episode(media_id):
    """Add a new episode to a series via manual link or API upload."""
    media = MediaItem.query.get_or_404(media_id)

    try:
        season_num = int(request.form.get('season_num', 1))
        episode_num = int(request.form.get('episode_num', 1))
    except ValueError:
        season_num = 1
        episode_num = 1

    episode_title = request.form.get('title', '').strip()
    upload_method = request.form.get('upload_method', 'manual')
    streamtape_id = None

    if upload_method == 'api_upload':
        if 'video_file' not in request.files or request.files['video_file'].filename == '':
            flash('Моля, изберете видео файл за качване!', 'danger')
            return redirect(url_for('admin_manage_episodes', media_id=media.id))

        file = request.files['video_file']
        if not allowed_file(file.filename):
            flash('Неразрешен формат на видео файла.', 'danger')
            return redirect(url_for('admin_manage_episodes', media_id=media.id))

        safe_name = secure_filename(file.filename)
        temp_path = os.path.join(TEMP_DIR, f"{int(datetime.now().timestamp())}_{safe_name}")

        try:
            file.save(temp_path)
            upload_result = upload_file_to_streamtape(
                file_path=temp_path,
                filename=safe_name,
                api_login=STREAMTAPE_LOGIN,
                api_key=STREAMTAPE_KEY
            )
            streamtape_id = upload_result.get('file_id')
        except Exception as e:
            flash(f"Грешка при качване на епизода: {str(e)}", 'danger')
            return redirect(url_for('admin_manage_episodes', media_id=media.id))
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
    else:
        raw_input = request.form.get('streamtape_id', '').strip()
        streamtape_id = extract_streamtape_id(raw_input)

    if not streamtape_id:
        flash('Необходим е валиден Streamtape ID или линк за епизода!', 'danger')
        return redirect(url_for('admin_manage_episodes', media_id=media.id))

    new_ep = Episode(
        media_id=media.id,
        season_num=season_num,
        episode_num=episode_num,
        title=episode_title or f"Епизод {episode_num}",
        streamtape_id=streamtape_id
    )

    db.session.add(new_ep)
    db.session.commit()

    flash(f"Епизод S{season_num:02d}E{episode_num:02d} беше добавен успешно!", 'success')
    return redirect(url_for('admin_manage_episodes', media_id=media.id))


@app.route('/admin/episode/delete/<int:id>', methods=['POST'])
@login_required
def admin_delete_episode(id):
    """Deletes an episode."""
    episode = Episode.query.get_or_404(id)
    media_id = episode.media_id
    db.session.delete(episode)
    db.session.commit()
    flash('Епизодът беше изтрит успешно.', 'info')
    return redirect(url_for('admin_manage_episodes', media_id=media_id))


# ==========================================
# ERROR HANDLERS
# ==========================================

@app.errorhandler(404)
def page_not_found(e):
    return render_template('base.html', not_found=True), 404


@app.errorhandler(413)
def request_entity_too_large(e):
    flash('Файлът е твърде голям за качване през браузъра (надхвърля ограничението).', 'danger')
    return redirect(request.referrer or url_for('admin_dashboard')), 413


# ==========================================
# STREAMTAPE DIRECT BROWSER UPLOAD API
# ==========================================

@app.route('/api/streamtape/get-upload-url')
@login_required
def api_get_upload_url():
    """
    Returns an upload URL from Streamtape so the browser can stream
    the video file directly to Streamtape servers, completely bypassing
    Render's 512MB RAM and avoiding 502 Bad Gateway timeouts!
    """
    try:
        from streamtape import get_upload_url
        upload_url = get_upload_url(STREAMTAPE_LOGIN, STREAMTAPE_KEY)
        return jsonify({'success': True, 'upload_url': upload_url})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400


# ==========================================
# DATABASE INITIALIZATION HELPER
# ==========================================

def create_tables():
    """Creates database tables safely if they do not exist."""
    try:
        with app.app_context():
            db.create_all()
    except Exception as e:
        app.logger.warning(f"Database initialization warning: {e}")


# Create tables safely on startup
create_tables()


@app.before_request
def ensure_db_ready():
    """Ensure database connection is ready on first request."""
    if not getattr(app, '_db_initialized', False):
        try:
            db.create_all()
            app._db_initialized = True
        except Exception:
            pass


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
