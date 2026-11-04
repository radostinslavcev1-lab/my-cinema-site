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
from sqlalchemy import inspect, text

from database import db
from models import MediaItem, Episode, SiteSetting, get_current_bulgarian_time
from streamtape import (
    extract_streamtape_id, upload_file_to_streamtape,
    check_api_status, StreamtapeAPIError
)
from abyss import (
    login_abyss, check_abyss_status, get_abyss_file_info,
    upload_to_abyss, extract_abyss_id, AbyssAPIError
)

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# --- Configuration ---
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'cinema-super-secret-key-change-in-production-2026')

# Database URL configuration (Support both SQLite locally and PostgreSQL on Render/Heroku)
database_url = os.environ.get('DATABASE_URL')
if database_url:
    # Ensure correct driver is used with SQLAlchemy (postgresql+psycopg2)
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql+psycopg2://', 1)
    elif database_url.startswith('postgresql://') and not database_url.startswith('postgresql+'):
        database_url = database_url.replace('postgresql://', 'postgresql+psycopg2://', 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
else:
    # Local SQLite
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///cinema.db'

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Maximum upload file size: 5 GB for video files
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH_MB', 5000)) * 1024 * 1024
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

# Allowed video and image extensions
ALLOWED_EXTENSIONS = {'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'm4v'}
ALLOWED_IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp', 'gif'}

# Streamtape credentials
STREAMTAPE_LOGIN = os.environ.get('STREAMTAPE_LOGIN', '').strip()
STREAMTAPE_KEY = os.environ.get('STREAMTAPE_KEY', '').strip()

# Abyss.to / Hydrax credentials (pre-configured with user's key)
ABYSS_API_KEY = os.environ.get('ABYSS_API_KEY', 'e46f14fa7d0b24e0e237e036071887b2').strip()

# Admin credentials
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'Radkoo_admin123').strip()
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'Radi_admina').strip()

# Initialize DB with App
db.init_app(app)

# Ensure temporary upload directory exists
TEMP_DIR = os.path.join(tempfile.gettempdir(), 'cinema_streamtape_uploads')
os.makedirs(TEMP_DIR, exist_ok=True)


def is_site_locked() -> bool:
    """Returns True if the site is locked in maintenance mode."""
    try:
        return SiteSetting.get('site_locked', '0') == '1'
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass
        return False


def get_maintenance_message() -> str:
    """Returns the custom message displayed when the site is locked."""
    try:
        return SiteSetting.get(
            'maintenance_message',
            'Сайтът временно е недостъпен поради техническо обновяване. Моля, заповядайте отново по-късно.'
        )
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass
        return 'Сайтът временно е недостъпен.'


def allowed_file(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def allowed_image(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def save_uploaded_image(file_storage, folder_name='banners'):
    """Saves an uploaded image locally and returns its public URL path."""
    if not file_storage or not file_storage.filename or not allowed_image(file_storage.filename):
        return None
    safe_name = f"{int(datetime.now().timestamp())}_{secure_filename(file_storage.filename)}"
    target_dir = os.path.join(app.root_path, 'static', 'uploads', folder_name)
    os.makedirs(target_dir, exist_ok=True)
    file_storage.save(os.path.join(target_dir, safe_name))
    return url_for('static', filename=f'uploads/{folder_name}/{safe_name}')


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
        try:
            db.session.rollback()
        except Exception:
            pass
        genres_list = []

    return {
        'is_admin': session.get('is_admin', False),
        'admin_user': session.get('admin_user', ''),
        'current_year': datetime.now().year,
        'all_genres': genres_list,
        'streamtape_configured': bool(STREAMTAPE_LOGIN and STREAMTAPE_KEY),
        'site_is_locked': is_site_locked(),
        'maintenance_message': get_maintenance_message()
    }


@app.before_request
def check_site_maintenance():
    """Blocks unauthenticated visitors with a 503 maintenance page when site is locked."""
    try:
        ensure_db_ready()
    except Exception as e:
        app.logger.warning(f"ensure_db_ready notice in before_request: {e}")
        try:
            db.session.rollback()
        except Exception:
            pass

    # Always permit static assets, login and logout endpoints
    if request.path.startswith('/static/') or request.endpoint in ('static', 'login', 'logout'):
        return None

    # Logged-in admin has full access everywhere
    if session.get('is_admin'):
        return None

    try:
        if is_site_locked():
            msg = get_maintenance_message()
            return render_template('maintenance.html', message=msg), 503
    except Exception as e:
        app.logger.warning(f"Maintenance check notice: {e}")
        try:
            db.session.rollback()
        except Exception:
            pass

    return None


# ==========================================
# PUBLIC CATALOG ROUTES
# ==========================================

@app.route('/')
def index():
    """Main Catalog Page: Movie/Series Grid with Search, Filters and Sorting."""
    if request.args.get('blocked') == 'recording':
        flash('🚫 Достъпът до видеото беше прекратен поради засичане на софтуер за запис на екрана или скрийншот!', 'danger')

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
        # 1. First look for an item explicitly marked as is_featured
        featured_item = MediaItem.query.filter_by(is_featured=True).first()
        if not featured_item:
            # 2. Otherwise pick first item with backdrop or poster
            featured_candidates = [i for i in items if i.backdrop_url or i.poster_url]
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
    active_embed_url = None
    active_server_name = None
    is_episode_locked = False

    is_admin = bool(session.get('is_admin'))

    if item.media_type == 'series':
        ep_id = request.args.get('ep', type=int)
        if ep_id:
            current_episode = Episode.query.filter_by(id=ep_id, media_id=item.id).first()

        # If no episode specified or invalid, default to the first available episode
        if not current_episode and item.episodes:
            current_episode = item.episodes[0]

        if current_episode:
            is_episode_locked = current_episode.is_currently_locked
            active_server_name = current_episode.server_name
            if is_episode_locked and not is_admin:
                # Do NOT expose stream URL to normal visitors for locked episodes
                active_streamtape_id = None
                active_embed_url = None
            else:
                active_streamtape_id = current_episode.streamtape_id
                active_embed_url = current_episode.embed_url
        else:
            active_streamtape_id = item.streamtape_id
            active_embed_url = item.embed_url
            active_server_name = item.server_name
    else:
        # Movie
        active_streamtape_id = item.streamtape_id
        active_embed_url = item.embed_url
        active_server_name = item.server_name

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
        active_embed_url=active_embed_url,
        active_server_name=active_server_name,
        is_episode_locked=is_episode_locked,
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

    # Check Abyss.to API status
    abyss_status = check_abyss_status(ABYSS_API_KEY)

    return render_template(
        'admin.html',
        items=media_items,
        total_count=total_count,
        movie_count=movie_count,
        series_count=series_count,
        total_episodes=total_episodes,
        api_status=api_status,
        current_streamtape_login=STREAMTAPE_LOGIN,
        current_streamtape_key=STREAMTAPE_KEY,
        abyss_status=abyss_status,
        current_abyss_key=ABYSS_API_KEY
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


@app.route('/admin/settings/abyss', methods=['POST'])
@login_required
def admin_settings_abyss():
    """Allows updating Abyss.to API Key directly from Admin Panel."""
    global ABYSS_API_KEY
    import re

    key_val = request.form.get('abyss_api_key', '').strip()

    if not key_val:
        flash('Моля, въведете Abyss.to API Key!', 'warning')
        return redirect(url_for('admin_dashboard'))

    ABYSS_API_KEY = key_val

    # Update in .env file
    env_file = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(env_file):
        try:
            with open(env_file, 'r', encoding='utf-8') as f:
                content = f.read()

            if 'ABYSS_API_KEY=' in content:
                content = re.sub(r'ABYSS_API_KEY=.*', f'ABYSS_API_KEY={key_val}', content)
            else:
                content += f"\nABYSS_API_KEY={key_val}\n"

            with open(env_file, 'w', encoding='utf-8') as f:
                f.write(content)
        except Exception:
            pass

    # Test status immediately
    status = check_abyss_status(ABYSS_API_KEY)
    if status.get('valid'):
        flash(f"Успешно свързване с Abyss.to API! Максимален размер: {status.get('max_upload_gb')} (Лимит: {status.get('limit_gb', 'N/A')})", 'success')
    else:
        flash(f"Ключът е записан, но Abyss.to върна: {status.get('message', 'Грешка')}", 'warning')

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

    if upload_method == 'abyss_upload':
        # Automatic upload of media to Abyss / Hydrax API (up to 10 GB)
        file = request.files.get('abyss_file') or request.files.get('video_file')
        if not file or file.filename == '':
            flash('Не е избран видео файл за качване в Abyss / Hydrax!', 'danger')
            return redirect(url_for('admin_dashboard'))

        if not allowed_file(file.filename):
            allowed_str = ', '.join(ALLOWED_EXTENSIONS)
            flash(f'Невалиден формат на файла. Разрешени формати: {allowed_str}', 'danger')
            return redirect(url_for('admin_dashboard'))

        safe_name = secure_filename(file.filename)
        temp_path = os.path.join(TEMP_DIR, f"abyss_{int(datetime.now().timestamp())}_{safe_name}")

        try:
            file.save(temp_path)
            upload_result = upload_to_abyss(temp_path, ABYSS_API_KEY)
            slug = upload_result.get('slug')
            streamtape_id = f"abyss:{slug}"
            flash(f"Успешно качване в Abyss / Hydrax! Slug: {slug}", 'success')
        except AbyssAPIError as e:
            flash(f"Грешка при Abyss / Hydrax API: {str(e)}", 'danger')
            return redirect(url_for('admin_dashboard'))
        except Exception as e:
            flash(f"Неочаквана грешка при качване в Abyss / Hydrax: {str(e)}", 'danger')
            return redirect(url_for('admin_dashboard'))
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
    elif upload_method == 'api_upload':
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
        # Method: Manual entry (Google Drive, Abyss / Hydrax or Streamtape)
        raw_streamtape_input = request.form.get('streamtape_id', '').strip()
        server_type = request.form.get('server_type', 'auto').strip()
        streamtape_id = extract_streamtape_id(raw_streamtape_input, server_type)

        if media_type == 'movie' and not streamtape_id:
            flash('За филм е необходимо да въведете валиден Google Drive, Abyss / Hydrax или Streamtape ID / линк!', 'danger')
            return redirect(url_for('admin_dashboard'))

    # Handle image file uploads
    backdrop_url = request.form.get('backdrop_url', '').strip()
    is_featured = bool(request.form.get('is_featured'))

    if 'backdrop_file' in request.files and request.files['backdrop_file'].filename:
        uploaded_backdrop = save_uploaded_image(request.files['backdrop_file'], 'banners')
        if uploaded_backdrop:
            backdrop_url = uploaded_backdrop

    if 'poster_file' in request.files and request.files['poster_file'].filename:
        uploaded_poster = save_uploaded_image(request.files['poster_file'], 'posters')
        if uploaded_poster:
            poster_url = uploaded_poster

    if is_featured:
        MediaItem.query.update({MediaItem.is_featured: False})

    # Create MediaItem record
    new_media = MediaItem(
        title=title,
        description=description,
        release_year=release_year,
        genre=genre,
        rating=rating,
        poster_url=poster_url,
        backdrop_url=backdrop_url,
        is_featured=is_featured,
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
        item.backdrop_url = request.form.get('backdrop_url', '').strip()

        # Handle image file uploads
        if 'backdrop_file' in request.files and request.files['backdrop_file'].filename:
            uploaded_backdrop = save_uploaded_image(request.files['backdrop_file'], 'banners')
            if uploaded_backdrop:
                item.backdrop_url = uploaded_backdrop

        if 'poster_file' in request.files and request.files['poster_file'].filename:
            uploaded_poster = save_uploaded_image(request.files['poster_file'], 'posters')
            if uploaded_poster:
                item.poster_url = uploaded_poster

        # Update is_featured flag
        is_featured = bool(request.form.get('is_featured'))
        if is_featured:
            MediaItem.query.update({MediaItem.is_featured: False})
            item.is_featured = True
        else:
            item.is_featured = False

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
            server_type = request.form.get('server_type', 'auto').strip()
            item.streamtape_id = extract_streamtape_id(raw_id, server_type)

        db.session.commit()
        flash(f"Заглавието „{item.title}“ беше обновено успешно!", 'success')
        return redirect(url_for('admin_dashboard'))

    return render_template('admin_edit.html', item=item)


@app.route('/admin/featured/<int:id>', methods=['POST'])
@login_required
def admin_toggle_featured(id):
    """Sets the selected movie/series as the Hero Banner on the home page."""
    item = MediaItem.query.get_or_404(id)
    # Clear any previous featured item
    MediaItem.query.update({MediaItem.is_featured: False})
    item.is_featured = True
    db.session.commit()
    flash(f"Заглавието „{item.title}“ беше избрано за водещ Hero банер на началната страница!", 'success')
    return redirect(url_for('admin_dashboard'))


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

    if upload_method == 'abyss_upload':
        # Automatic upload of episode to Abyss / Hydrax API (up to 10 GB)
        file = request.files.get('abyss_video_file') or request.files.get('abyss_file') or request.files.get('video_file')
        if not file or file.filename == '':
            flash('Не е избран видео файл за качване в Abyss / Hydrax!', 'danger')
            return redirect(url_for('admin_manage_episodes', media_id=media.id))

        if not allowed_file(file.filename):
            allowed_str = ', '.join(ALLOWED_EXTENSIONS)
            flash(f'Невалиден формат на файла. Разрешени формати: {allowed_str}', 'danger')
            return redirect(url_for('admin_manage_episodes', media_id=media.id))

        safe_name = secure_filename(file.filename)
        temp_path = os.path.join(TEMP_DIR, f"ep_abyss_{int(datetime.now().timestamp())}_{safe_name}")

        try:
            file.save(temp_path)
            upload_result = upload_to_abyss(temp_path, ABYSS_API_KEY)
            slug = upload_result.get('slug')
            streamtape_id = f"abyss:{slug}"
            flash(f"Успешно качване на епизода в Abyss / Hydrax! Slug: {slug}", 'success')
        except AbyssAPIError as e:
            flash(f"Грешка при Abyss / Hydrax API: {str(e)}", 'danger')
            return redirect(url_for('admin_manage_episodes', media_id=media.id))
        except Exception as e:
            flash(f"Неочаквана грешка при качване в Abyss / Hydrax: {str(e)}", 'danger')
            return redirect(url_for('admin_manage_episodes', media_id=media.id))
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
    elif upload_method == 'api_upload':
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
        server_type = request.form.get('server_type', 'auto').strip()
        streamtape_id = extract_streamtape_id(raw_input, server_type)

    if not streamtape_id:
        flash('Необходим е валиден Google Drive, Abyss / Hydrax или Streamtape ID / линк за епизода!', 'danger')
        return redirect(url_for('admin_manage_episodes', media_id=media.id))

    is_locked = bool(request.form.get('is_locked'))
    release_date_str = request.form.get('release_date', '').strip()
    release_date = None
    if release_date_str:
        try:
            release_date = datetime.strptime(release_date_str, '%Y-%m-%dT%H:%M')
        except Exception:
            try:
                release_date = datetime.fromisoformat(release_date_str)
            except Exception:
                release_date = None

    curr_bg = get_current_bulgarian_time()
    user_checked = bool(request.form.get('is_locked'))
    if release_date and release_date > curr_bg:
        is_locked = True
    else:
        is_locked = user_checked

    custom_message = request.form.get('custom_message', '').strip() or None

    new_ep = Episode(
        media_id=media.id,
        season_num=season_num,
        episode_num=episode_num,
        title=episode_title or f"Епизод {episode_num}",
        streamtape_id=streamtape_id,
        is_locked=is_locked,
        release_date=release_date,
        custom_message=custom_message
    )

    db.session.add(new_ep)
    db.session.commit()

    lock_note = " (🔒 Заключен за премиера)" if new_ep.is_currently_locked else ""
    flash(f"Епизод S{season_num:02d}E{episode_num:02d} беше добавен успешно!{lock_note}", 'success')
    return redirect(url_for('admin_manage_episodes', media_id=media.id))


@app.route('/admin/episode/toggle-lock/<int:id>', methods=['POST'])
@login_required
def admin_toggle_episode_lock(id):
    """Toggles locked status of an episode directly."""
    ep = Episode.query.get_or_404(id)
    if ep.is_currently_locked:
        # Unlock immediately and remove future date restriction
        ep.is_locked = False
        ep.release_date = None
        db.session.commit()
        flash(f"🔓 Епизод {ep.display_code} беше отключен успешно за всички посетители.", 'success')
    else:
        # Lock immediately
        ep.is_locked = True
        db.session.commit()
        flash(f"🔒 Епизод {ep.display_code} беше заключен (Очаквайте скоро).", 'warning')
    return redirect(request.referrer or url_for('admin_manage_episodes', media_id=ep.media_id))


@app.route('/admin/episode/update-lock/<int:id>', methods=['POST'])
@login_required
def admin_update_episode_lock(id):
    """Updates release date and custom message on an episode."""
    ep = Episode.query.get_or_404(id)

    release_date_str = request.form.get('release_date', '').strip()
    if release_date_str:
        try:
            ep.release_date = datetime.strptime(release_date_str, '%Y-%m-%dT%H:%M')
        except Exception:
            try:
                ep.release_date = datetime.fromisoformat(release_date_str)
            except Exception:
                ep.release_date = None
    else:
        ep.release_date = None

    curr_bg = get_current_bulgarian_time()
    user_checked = bool(request.form.get('is_locked'))
    if ep.release_date and ep.release_date > curr_bg:
        ep.is_locked = True
    else:
        ep.is_locked = user_checked

    ep.custom_message = request.form.get('custom_message', '').strip() or None
    db.session.commit()

    if ep.is_currently_locked:
        date_info = f" до {ep.formatted_release_date}" if ep.release_date else ""
        flash(f"🔒 Епизод {ep.display_code} е успешно заключен (Очаквайте скоро{date_info})!", 'warning')
    else:
        flash(f"🔓 Епизод {ep.display_code} е отключен и достъпен за всички.", 'success')

    return redirect(request.referrer or url_for('admin_manage_episodes', media_id=ep.media_id))


@app.route('/admin/site-lock/toggle', methods=['POST'])
@login_required
def admin_toggle_site_lock():
    """Toggles maintenance mode locking the entire site for visitors."""
    currently_locked = is_site_locked()
    new_locked = not currently_locked
    SiteSetting.set('site_locked', '1' if new_locked else '0')

    custom_msg = request.form.get('maintenance_message')
    if custom_msg is not None and custom_msg.strip():
        SiteSetting.set('maintenance_message', custom_msg.strip())

    if new_locked:
        flash('🔒 Сайтът е успешно заключен! Обикновените посетители виждат екран за профилактика.', 'warning')
    else:
        flash('🔓 Сайтът беше отключен успешно! Вече е свободен и видим за всички посетители.', 'success')
    return redirect(request.referrer or url_for('admin_dashboard'))


@app.route('/admin/site-lock/message', methods=['POST'])
@login_required
def admin_update_site_lock_message():
    """Updates custom maintenance text for the site lock."""
    msg = request.form.get('maintenance_message', '').strip()
    if msg:
        SiteSetting.set('maintenance_message', msg)
        flash('Съобщението за профилактика беше обновено успешно.', 'success')
    return redirect(request.referrer or url_for('admin_dashboard'))


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


@app.errorhandler(500)
def internal_server_error(e):
    try:
        db.session.rollback()
    except Exception:
        pass
    app.logger.error(f"Internal Server Error (500): {e}", exc_info=True)
    try:
        return render_template(
            'base.html',
            not_found=True,
            error_code="500",
            error_title="Възникна временна грешка",
            error_message="В момента се извършва обновяване на базата данни. Моля, опреснете страницата след секунда."
        ), 500
    except Exception:
        return """<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Временно обновяване - CINEMAX</title>
  <style>
    body { background: #0a0b0e; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; padding: 20px; }
    .card { background: rgba(22, 25, 36, 0.95); border: 1px solid rgba(229, 9, 20, 0.35); border-radius: 20px; padding: 40px 24px; max-width: 480px; width: 100%; box-shadow: 0 16px 45px rgba(0,0,0,0.8); }
    h1 { color: #e50914; margin-bottom: 12px; font-size: 1.6rem; }
    p { color: #9aa0a6; line-height: 1.5; font-size: 0.95rem; margin-bottom: 24px; }
    a { display: inline-block; background: #e50914; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 9999px; font-weight: 700; transition: transform 0.2s; }
    a:hover { transform: scale(1.04); }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 40px; margin-bottom: 12px;">🎬</div>
    <h1>Временно обновяване</h1>
    <p>Сървърът в момента синхронизира данните от новия ъпдейт. Моля, изчакайте няколко секунди и опреснете страницата.</p>
    <a href="javascript:location.reload()">🔄 Опресни страницата</a>
  </div>
</body>
</html>""", 500


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
# ABYSS.TO DIRECT BROWSER UPLOAD API
# ==========================================

@app.route('/api/abyss/get-upload-url')
@login_required
def api_abyss_get_upload_url():
    """
    Returns the direct upload URL for Abyss / Hydrax: https://up.hydrax.net/{ABYSS_API_KEY}
    allowing the browser to stream up to 10 GB directly to the servers.
    """
    key = ABYSS_API_KEY or "e46f14fa7d0b24e0e237e036071887b2"
    return jsonify({
        'success': True,
        'upload_url': f"https://up.hydrax.net/{key}",
        'fallback_url': f"https://up.abyss.to/{key}",
        'api_key': key
    })


@app.route('/api/abyss/upload', methods=['POST'])
@login_required
def api_abyss_upload_proxy():
    """
    Proxy upload to Abyss.to for environments that upload via backend.
    """
    if not ABYSS_API_KEY:
        return jsonify({'success': False, 'error': 'Липсва конфигуриран Abyss.to API Key.'}), 400

    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'Няма качен видео файл.'}), 400

    file = request.files['file']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify({'success': False, 'error': 'Невалиден или неподдържан видео файл.'}), 400

    safe_name = secure_filename(file.filename)
    temp_path = os.path.join(TEMP_DIR, f"abyss_proxy_{int(datetime.now().timestamp())}_{safe_name}")

    try:
        file.save(temp_path)
        res = upload_to_abyss(temp_path, ABYSS_API_KEY)
        return jsonify(res)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


# ==========================================
# DATABASE INITIALIZATION & MIGRATION HELPER
# ==========================================

def ensure_db_ready():
    """
    Ensures database tables and newly introduced columns exist safely
    across both PostgreSQL (production) and SQLite (development).
    """
    if getattr(app, '_db_initialized', False):
        return

    try:
        # 1. Create all missing tables first (e.g., site_settings)
        db.create_all()

        is_postgres = False
        try:
            is_postgres = db.engine.url.drivername.startswith('postgres')
        except Exception:
            pass

        if is_postgres:
            # PostgreSQL natively supports ADD COLUMN IF NOT EXISTS without throwing DuplicateColumn
            migrations = [
                "ALTER TABLE media_items ADD COLUMN IF NOT EXISTS backdrop_url VARCHAR(500)",
                "ALTER TABLE media_items ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE",
                "ALTER TABLE episodes ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE",
                "ALTER TABLE episodes ADD COLUMN IF NOT EXISTS release_date TIMESTAMP NULL",
                "ALTER TABLE episodes ADD COLUMN IF NOT EXISTS custom_message VARCHAR(255) NULL"
            ]
            for stmt in migrations:
                try:
                    with db.engine.begin() as conn:
                        conn.execute(text(stmt))
                except Exception as ex:
                    app.logger.warning(f"PostgreSQL migration notice for '{stmt}': {ex}")
        else:
            # SQLite inspection-based migration
            inspector = inspect(db.engine)
            tables = inspector.get_table_names()

            if 'media_items' in tables:
                media_cols = {c['name'].lower() for c in inspector.get_columns('media_items')}
                if 'backdrop_url' not in media_cols:
                    try:
                        with db.engine.begin() as conn:
                            conn.execute(text("ALTER TABLE media_items ADD COLUMN backdrop_url VARCHAR(500)"))
                    except Exception:
                        pass
                if 'is_featured' not in media_cols:
                    try:
                        with db.engine.begin() as conn:
                            conn.execute(text("ALTER TABLE media_items ADD COLUMN is_featured BOOLEAN DEFAULT FALSE"))
                    except Exception:
                        pass

            if 'episodes' in tables:
                ep_cols = {c['name'].lower() for c in inspector.get_columns('episodes')}
                if 'is_locked' not in ep_cols:
                    try:
                        with db.engine.begin() as conn:
                            conn.execute(text("ALTER TABLE episodes ADD COLUMN is_locked BOOLEAN DEFAULT FALSE"))
                    except Exception:
                        pass
                if 'release_date' not in ep_cols:
                    try:
                        with db.engine.begin() as conn:
                            conn.execute(text("ALTER TABLE episodes ADD COLUMN release_date TIMESTAMP NULL"))
                    except Exception:
                        pass
                if 'custom_message' not in ep_cols:
                    try:
                        with db.engine.begin() as conn:
                            conn.execute(text("ALTER TABLE episodes ADD COLUMN custom_message VARCHAR(255) NULL"))
                    except Exception:
                        pass

        app._db_initialized = True
    except Exception as e:
        app.logger.error(f"ensure_db_ready encountered error: {e}", exc_info=True)
        try:
            db.session.rollback()
        except Exception:
            pass


def create_tables():
    """Initializes tables and migrations on application boot."""
    try:
        with app.app_context():
            ensure_db_ready()
    except Exception as e:
        app.logger.warning(f"Startup DB init warning: {e}")


# Initialize database safely on startup
create_tables()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
