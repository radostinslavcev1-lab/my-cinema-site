"""
AnonMP4 Official API Integration Module
Handles video uploading and metadata querying for AnonMP4.
Platform: https://anonmp4.to
"""
import os
import math
import logging
import requests

logger = logging.getLogger(__name__)

ANONMP4_BASE = "https://anonmp4.to"
CLIENT_TOKEN = "TWE0eDdmOU5xME1mOU1hNElmOU1UcDlhNHU0REU0TmE0RTJNYTRVM05hNE0"


class AnonMP4APIError(Exception):
    """Custom exception for AnonMP4 API failures."""
    pass


def get_anonmp4_upload_node(filename: str = "video.mp4") -> dict:
    """
    Obtains the dedicated Cloudflare Worker upload node and tokens for a video file.
    Returns: { 'status': True, 'node_id': '...', 'upload_url': '...', 'node_token': '...' }
    """
    url = f"{ANONMP4_BASE}/get-upload-node"
    data = {
        'client_token': CLIENT_TOKEN,
        'filename': filename
    }
    try:
        resp = requests.post(url, data=data, timeout=25)
        resp.raise_for_status()
        json_data = resp.json()

        if not json_data.get('status') or not json_data.get('upload_url'):
            msg = json_data.get('message') or "AnonMP4 не предостави адрес за качване."
            raise AnonMP4APIError(msg)

        return json_data
    except requests.exceptions.RequestException as e:
        logger.error(f"AnonMP4 get_upload_node error: {e}")
        raise AnonMP4APIError(f"Грешка при връзка с AnonMP4 сървъра: {str(e)}")
    except ValueError:
        raise AnonMP4APIError("AnonMP4 върна невалиден отговор.")


def get_anonmp4_video_info(node_id: str, node_token: str, filename: str = "video.mp4") -> dict:
    """
    Finalizes the video upload on the node and returns metadata including video_id.
    Returns: { 'success': True, 'video_id': '...', 'embed_url': '...', 'watch_url': '...' }
    """
    url = f"{ANONMP4_BASE}/get-video-node"
    data = {
        'node_id': node_id,
        'node_token': node_token,
        'client_token': CLIENT_TOKEN,
        'filename': filename
    }
    try:
        resp = requests.post(url, data=data, timeout=35)
        resp.raise_for_status()
        json_data = resp.json()

        if json_data.get('success') is False or json_data.get('status') == 'error':
            msg = json_data.get('message') or "Грешка при обработка на видеото в AnonMP4."
            raise AnonMP4APIError(msg)

        video_id = json_data.get('video_id')
        if not video_id:
            raise AnonMP4APIError("AnonMP4 не върна Video ID.")

        return {
            'success': True,
            'video_id': video_id,
            'embed_url': json_data.get('embed_url') or f"https://anonmp4.to/embed/{video_id}",
            'watch_url': json_data.get('watch_url') or f"https://anonmp4.to/v/{video_id}",
            'thumbnail': json_data.get('thumbnail')
        }
    except requests.exceptions.RequestException as e:
        logger.error(f"AnonMP4 get_video_info error: {e}")
        raise AnonMP4APIError(f"Грешка при финализиране на видеото в AnonMP4: {str(e)}")


def upload_to_anonmp4(file_path: str, chunk_size: int = 2 * 1024 * 1024) -> dict:
    """
    Server-side fallback: uploads a local file in 2MB chunks to the AnonMP4 worker.
    """
    if not os.path.exists(file_path):
        raise AnonMP4APIError(f"Файлът не е намерен: {file_path}")

    filename = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)

    # 1. Get Node
    node_data = get_anonmp4_upload_node(filename)
    upload_url = node_data['upload_url']
    node_id = node_data['node_id']
    node_token = node_data['node_token']

    # 2. Upload Chunks
    total_chunks = max(1, math.ceil(file_size / chunk_size))

    with open(file_path, 'rb') as f:
        for chunk_idx in range(1, total_chunks + 1):
            chunk_data = f.read(chunk_size)
            start = (chunk_idx - 1) * chunk_size
            end = start + len(chunk_data)

            params = {
                'file_id': node_token,
                'chunkIndex': chunk_idx,
                'totalChunks': total_chunks,
                'filename': filename
            }
            headers = {
                'Content-Disposition': f'attachment; filename="{filename}"',
                'Content-Range': f'bytes {start}-{end - 1}/{file_size}',
                'Content-Type': 'application/octet-stream',
                'X-Uploading-Mode': 'parallel'
            }

            resp = requests.post(upload_url, params=params, headers=headers, data=chunk_data, timeout=60)
            resp.raise_for_status()

    # 3. Finalize and get video info
    return get_anonmp4_video_info(node_id, node_token, filename)
