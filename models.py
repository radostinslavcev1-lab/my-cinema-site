import re
from datetime import datetime
from database import db


class MediaItem(db.Model):
    """
    Represents a movie or a TV series in the catalog.
    For movies: streamtape_id stores the direct video identifier.
    For series: episodes relationship stores individual season/episode streamtape_ids.
    """
    __tablename__ = 'media_items'

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False, index=True)
    description = db.Column(db.Text, nullable=True)
    release_year = db.Column(db.Integer, nullable=True, index=True)
    genre = db.Column(db.String(150), nullable=True, index=True)
    rating = db.Column(db.Float, nullable=True, default=7.0)
    poster_url = db.Column(db.String(500), nullable=True)
    media_type = db.Column(db.String(20), nullable=False, default='movie', index=True)  # 'movie' or 'series'
    streamtape_id = db.Column(db.String(100), nullable=True)  # Used when media_type == 'movie'
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    # Relationship to episodes (only applicable when media_type == 'series')
    episodes = db.relationship(
        'Episode',
        backref='media_item',
        cascade='all, delete-orphan',
        lazy=True,
        order_by='Episode.season_num, Episode.episode_num'
    )

    @property
    def embed_url(self):
        """Returns the Streamtape iframe embed URL for movies."""
        if self.streamtape_id:
            return f"https://streamtape.com/e/{self.streamtape_id}/"
        return None

    @property
    def safe_poster_url(self):
        """Returns the poster URL or a default placeholder."""
        if self.poster_url and self.poster_url.strip():
            return self.poster_url.strip()
        return "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=600&q=80"

    @property
    def genres_list(self):
        """Returns clean list of genre strings."""
        if not self.genre:
            return []
        return [g.strip() for g in self.genre.split(',') if g.strip()]

    @property
    def seasons_dict(self):
        """
        Groups episodes by season number in sorted order.
        Returns: {1: [Episode1, Episode2], 2: [...]}
        """
        seasons = {}
        for ep in self.episodes:
            seasons.setdefault(ep.season_num, []).append(ep)
        return dict(sorted(seasons.items()))

    @property
    def episode_count(self):
        return len(self.episodes)

    @property
    def formatted_rating(self):
        if self.rating is not None:
            return f"{self.rating:.1f}"
        return "N/A"

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'description': self.description,
            'release_year': self.release_year,
            'genre': self.genre,
            'rating': self.rating,
            'poster_url': self.safe_poster_url,
            'media_type': self.media_type,
            'streamtape_id': self.streamtape_id,
            'embed_url': self.embed_url,
            'episode_count': self.episode_count,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M') if self.created_at else None
        }

    def __repr__(self):
        return f"<MediaItem {self.id}: {self.title} ({self.media_type})>"


class Episode(db.Model):
    """
    Represents an episode of a TV series with its own Streamtape Video ID.
    """
    __tablename__ = 'episodes'

    id = db.Column(db.Integer, primary_key=True)
    media_id = db.Column(db.Integer, db.ForeignKey('media_items.id', ondelete='CASCADE'), nullable=False, index=True)
    season_num = db.Column(db.Integer, nullable=False, default=1)
    episode_num = db.Column(db.Integer, nullable=False, default=1)
    title = db.Column(db.String(255), nullable=True)
    streamtape_id = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    @property
    def embed_url(self):
        return f"https://streamtape.com/e/{self.streamtape_id}/"

    @property
    def display_code(self):
        return f"S{self.season_num:02d}E{self.episode_num:02d}"

    @property
    def display_title(self):
        if self.title and self.title.strip():
            return f"{self.display_code}: {self.title.strip()}"
        return f"{self.display_code} - Епизод {self.episode_num}"

    def to_dict(self):
        return {
            'id': self.id,
            'media_id': self.media_id,
            'season_num': self.season_num,
            'episode_num': self.episode_num,
            'title': self.title,
            'display_code': self.display_code,
            'display_title': self.display_title,
            'streamtape_id': self.streamtape_id,
            'embed_url': self.embed_url,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M') if self.created_at else None
        }

    def __repr__(self):
        return f"<Episode {self.id}: Media={self.media_id} {self.display_code}>"
