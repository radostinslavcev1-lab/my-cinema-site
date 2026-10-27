"""
Script to transfer all data from local SQLite (instance/cinema.db) to Neon PostgreSQL.
Usage: python transfer_to_neon.py "<NEON_DATABASE_URL>"
"""
import os
import sys
import sqlite3

def migrate(neon_url):
    if not neon_url:
        print("Error: Neon database URL is required.")
        sys.exit(1)

    # Sanitize postgresql URL for SQLAlchemy
    cleaned_url = neon_url.strip()
    if cleaned_url.startswith('postgres://'):
        cleaned_url = cleaned_url.replace('postgres://', 'postgresql+psycopg2://', 1)
    elif cleaned_url.startswith('postgresql://') and not cleaned_url.startswith('postgresql+'):
        cleaned_url = cleaned_url.replace('postgresql://', 'postgresql+psycopg2://', 1)

    print(f"Connecting to Neon PostgreSQL...")
    os.environ['DATABASE_URL'] = cleaned_url

    from app import app, db, MediaItem, Episode

    sqlite_path = os.path.join(os.path.dirname(__file__), 'instance', 'cinema.db')
    if not os.path.exists(sqlite_path):
        print(f"Error: Local database file not found at {sqlite_path}")
        sys.exit(1)

    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_c = sqlite_conn.cursor()

    with app.app_context():
        print("Creating tables in Neon PostgreSQL...")
        db.create_all()

        # Migrate MediaItems
        sqlite_c.execute("SELECT * FROM media_items")
        media_rows = sqlite_c.fetchall()
        print(f"Found {len(media_rows)} media items in local SQLite.")

        for row in media_rows:
            existing = MediaItem.query.get(row['id'])
            if not existing:
                item = MediaItem(
                    id=row['id'],
                    title=row['title'],
                    description=row['description'],
                    release_year=row['release_year'],
                    genre=row['genre'],
                    rating=row['rating'],
                    poster_url=row['poster_url'],
                    media_type=row['media_type'],
                    streamtape_id=row['streamtape_id'],
                    backdrop_url=row['backdrop_url'] if 'backdrop_url' in row.keys() else None,
                    is_featured=bool(row['is_featured']) if 'is_featured' in row.keys() else False
                )
                db.session.add(item)
                print(f"  + Added Media: {row['title']} ({row['media_type']})")
        db.session.commit()

        # Migrate Episodes
        sqlite_c.execute("SELECT * FROM episodes")
        episode_rows = sqlite_c.fetchall()
        print(f"Found {len(episode_rows)} episodes in local SQLite.")

        for row in episode_rows:
            existing = Episode.query.get(row['id'])
            if not existing:
                ep = Episode(
                    id=row['id'],
                    media_id=row['media_id'],
                    season_num=row['season_num'],
                    episode_num=row['episode_num'],
                    title=row['title'],
                    streamtape_id=row['streamtape_id']
                )
                db.session.add(ep)
                print(f"  + Added Episode: S{row['season_num']}E{row['episode_num']} for media #{row['media_id']}")
        db.session.commit()

        # Fix sequence in PostgreSQL so new auto-increment IDs work
        try:
            db.session.execute(db.text("SELECT setval(pg_get_serial_sequence('media_items', 'id'), coalesce(max(id), 1)) FROM media_items;"))
            db.session.execute(db.text("SELECT setval(pg_get_serial_sequence('episodes', 'id'), coalesce(max(id), 1)) FROM episodes;"))
            db.session.commit()
            print("PostgreSQL sequences successfully updated.")
        except Exception as e:
            print(f"Notice updating sequences: {e}")

        print("\n Migration successfully completed! All movies and episodes are now in Neon.")

if __name__ == '__main__':
    url = sys.argv[1] if len(sys.argv) > 1 else input("Enter your Neon PostgreSQL URL: ")
    migrate(url)
