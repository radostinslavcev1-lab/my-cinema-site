"""
AnonMP4 API Integration Module
Handles video uploading and metadata querying for AnonMP4.
API Base: https://anonmp4api.xyz/
"""
import os
import logging
import requests

logger = logging.getLogger(__name__)

ANONMP4_UPLOAD_URL = "https://anonmp4api.xyz/upload"
ANONMP4_INFO_URL = "https://anonmp4api.xyz/info/{}"


class AnonMP4APIError(Exception):
    """Custom exception for AnonMP4 API failures."""
    pass


def upload_to_anonmp4(file_path: str, timeout: int = 1800) -> dict:
    """
    Uploads a local video file to AnonMP4 (up to 20 GB).
    Returns dict with 'video_id', 'embed_url', 'watch_url', etc.
    """
    if not os.path.exists(file_path):
        raise AnonMP4APIError(f"Файлът не е намерен: {file_path}")

    filename = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)

    # 20 GB limit check
    if file_size > 20 * 1024 * 1024 * 1024:
        raise AnonMP4APIError("Файлът надвишава лимита от 20 GB на AnonMP4.")

    try:
        with open(file_path, 'rb') as f:
            files = {'file': (filename, f, 'video/mp4')}
            response = requests.post(ANONMP4_UPLOAD_URL, files=files, timeout=timeout)
            response.raise_for_status()
            data = response.json()

        if data.get('success') or data.get('status') is True or data.get('video_id'):
            video_id = data.get('video_id')
            return {
                'video_id': video_id,
                'embed_url': data.get('embed_url') or f"https://anonmp4.to/embed/{video_id}",
                'watch_url': data.get('watch_url') or f"https://anonmp4.to/v/{video_id}",
                'thumbnail': data.get('thumbnail')
            }
        else:
            err = (data.get('error') or {}).get('message') or data.get('message') or 'Неизвестна грешка от AnonMP4'
            raise AnonMP4APIError(f"AnonMP4 отхвърли файла: {err}")

    except requests.exceptions.RequestException as e:
        logger.error(f"Грешка при качване в AnonMP4: {e}")
        raise AnonMP4APIError(f"Мрежова грешка при връзка с AnonMP4: {str(e)}")
    except ValueError:
        raise AnonMP4APIError("AnonMP4 върна невалиден JSON отговор.")
