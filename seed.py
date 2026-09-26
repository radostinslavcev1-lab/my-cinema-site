"""
Seed script to populate initial sample movies and TV series into the cinema database.
Run with: python seed.py
"""
from app import app
from database import db
from models import MediaItem, Episode

SAMPLE_MEDIA = [
    {
        'title': 'Интерстелар (Interstellar)',
        'description': 'Екип от изследователи предприема най-важната мисия в историята на човечеството: пътуване отвъд нашата галактика, за да открият дали човечеството има бъдеще сред звездите.',
        'release_year': 2014,
        'genre': 'Фантастика, Приключенски, Драма',
        'rating': 8.7,
        'poster_url': 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
        'media_type': 'movie',
        'streamtape_id': '683wVpQp71s9XbZ'
    },
    {
        'title': 'Дюн: Част втора (Dune: Part Two)',
        'description': 'Пол Атреидски се обединява с Чани и свободните пустинни хора на Аракис, търсейки отмъщение срещу заговорниците, унищожили неговото семейство.',
        'release_year': 2024,
        'genre': 'Фантастика, Екшън, Приключенски',
        'rating': 8.6,
        'poster_url': 'https://image.tmdb.org/t/p/w500/czembW0Rk1Ke7lCJGhkAiDDQWv4.jpg',
        'media_type': 'movie',
        'streamtape_id': '4g7yVdQxZ8h9Pq'
    },
    {
        'title': 'Генезис (Inception)',
        'description': 'Дом Коб е опитен крадец, абсолютният най-добър в опасното изкуство на екстракцията: кражба на ценни тайни от дълбините на подсъзнанието по време на сън.',
        'release_year': 2010,
        'genre': 'Екшън, Фантастика, Трилър',
        'rating': 8.8,
        'poster_url': 'https://image.tmdb.org/t/p/w500/o29U9uF2n3g4J5bK9q5N6u8R.jpg',
        'media_type': 'movie',
        'streamtape_id': '3m9kLpQvW4s1Za'
    },
    {
        'title': 'Тъмният рицар (The Dark Knight)',
        'description': 'Когато заплахата, известна като Жокера, причинява хаос и безредие в Готъм Сити, Батман трябва да приеме едно от най-големите психологически и физически изпитания.',
        'release_year': 2008,
        'genre': 'Екшън, Криминален, Драма',
        'rating': 9.0,
        'poster_url': 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
        'media_type': 'movie',
        'streamtape_id': '7n2pXvLmQ9k4Rt'
    },
    {
        'title': 'Странни неща (Stranger Things)',
        'description': 'Когато младо момче изчезва в малък град, майка му, шефът на полицията и приятелите му трябва да се изправят пред ужасяващи свръхестествени сили.',
        'release_year': 2016,
        'genre': 'Драма, Фантастика, Ужаси',
        'rating': 8.7,
        'poster_url': 'https://image.tmdb.org/t/p/w500/49WJfeN0moxb9IPfGn8AIqMGskD.jpg',
        'media_type': 'series',
        'streamtape_id': None,
        'episodes': [
            {'season_num': 1, 'episode_num': 1, 'title': 'Изчезването на Уил Байърс', 'streamtape_id': '9kLpW4s1Za3m'},
            {'season_num': 1, 'episode_num': 2, 'title': 'Странницата на ул. Клен', 'streamtape_id': '8jKoV3r0Yz2l'},
            {'season_num': 1, 'episode_num': 3, 'title': 'Весела Коледа', 'streamtape_id': '7iJnU2q9Xy1k'},
            {'season_num': 2, 'episode_num': 1, 'title': 'МАДМАКС', 'streamtape_id': '6hImT1p8Wx0j'}
        ]
    },
    {
        'title': 'Опасно лош (Breaking Bad)',
        'description': 'Учител по химия в гимназия, диагностициран с неоперабилен рак на белите дробове, се обръща към производството и продажбата на метамфетамин.',
        'release_year': 2008,
        'genre': 'Криминален, Драма, Трилър',
        'rating': 9.5,
        'poster_url': 'https://image.tmdb.org/t/p/w500/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
        'media_type': 'series',
        'streamtape_id': None,
        'episodes': [
            {'season_num': 1, 'episode_num': 1, 'title': 'Пилотен епизод', 'streamtape_id': '5gHlS0o7Vw9i'},
            {'season_num': 1, 'episode_num': 2, 'title': 'Котката е в чувала...', 'streamtape_id': '4fGkR9n6Uv8h'},
            {'season_num': 1, 'episode_num': 3, 'title': '...и чувалът е в реката', 'streamtape_id': '3eFjQ8m5Tu7g'}
        ]
    }
]


def seed_database():
    with app.app_context():
        db.create_all()

        # Check if already seeded
        existing_count = MediaItem.query.count()
        if existing_count > 0:
            print(f"Базата данни вече съдържа {existing_count} заглавия. Пропускане на началното зареждане.")
            return

        print("Зареждане на примерни заглавия и епизоди в базата данни...")

        for data in SAMPLE_MEDIA:
            episodes_data = data.pop('episodes', [])
            item = MediaItem(**data)
            db.session.add(item)
            db.session.flush()  # To get item.id

            for ep in episodes_data:
                episode = Episode(
                    media_id=item.id,
                    season_num=ep['season_num'],
                    episode_num=ep['episode_num'],
                    title=ep['title'],
                    streamtape_id=ep['streamtape_id']
                )
                db.session.add(episode)

        db.session.commit()
        print("Успешно добавени примерни филми и сериали!")


if __name__ == '__main__':
    seed_database()
