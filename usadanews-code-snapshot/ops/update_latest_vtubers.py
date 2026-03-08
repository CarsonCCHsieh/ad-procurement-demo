# -*- coding: utf-8 -*-
import base64
import json
import os
import re
import time

import requests

WP_BASE = os.environ.get('USADA_WP_BASE', 'https://usadanews.com/wp-json/wp/v2').strip()
WP_USER = os.environ.get('USADA_WP_USER', '').strip()
WP_PASS = os.environ.get('USADA_WP_PASS', '').strip()

YT_KEYS = [x.strip() for x in (os.environ.get('USADA_YT_API_KEYS', '')).split(',') if x.strip()]

QUERIES = [
    'VTuber debut',
    '新人 VTuber',
    '新 VTuber',
    '台灣 VTuber',
    '台湾 VTuber',
    'EN VTuber',
    'JP VTuber',
    'バーチャルYouTuber',
]

KEYWORDS = [
    'vtuber', 'v-tuber', 'バーチャル', 'virtual youtuber', 'ブイチューバー', '虛擬', '虚拟', '버튜버'
]

MAX_CHANNELS = 60
MAX_UPDATES = 60

session = requests.Session()
session.headers['User-Agent'] = 'USADA-VTuber-Updater/1.0'


def wp_get_all_vtubers():
    page = 1
    items = []
    while True:
        r = session.get(
            f'{WP_BASE}/vtuber',
            params={'per_page': 100, 'page': page, '_fields': 'id,title,meta'},
            auth=(WP_USER, WP_PASS),
            timeout=20,
        )
        if r.status_code == 400:
            break
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        items.extend(batch)
        total_pages = int(r.headers.get('X-WP-TotalPages', page))
        if page >= total_pages:
            break
        page += 1
    return items


def normalize_yt(url: str):
    if not url:
        return ''
    u = url.strip().lower()
    u = re.sub(r'[?#].*$', '', u)
    m = re.search(r'/channel/([a-z0-9_-]+)', u)
    if m:
        return f'channel:{m.group(1)}'
    m = re.search(r'/@([^/]+)', u)
    if m:
        return f'handle:{m.group(1)}'
    return u


def extract_socials(desc: str):
    if not desc:
        return {}
    socials = {}
    patterns = {
        'vt_twitter_url': r'(https?://(?:x\.com|twitter\.com)/[\w_]+)',
        'vt_twitch_url': r'(https?://(?:www\.)?twitch\.tv/[\w_]+)',
        'vt_instagram': r'(https?://(?:www\.)?instagram\.com/[\w_.]+)',
        'vt_discord': r'(https?://(?:discord\.gg|discord\.com/invite)/[\w-]+)',
        'vt_bluesky_url': r'(https?://bsky\.app/profile/[\w.-]+)',
        'vt_facebook_url': r'(https?://(?:www\.)?facebook\.com/[\w./]+)',
        'vt_plurk': r'(https?://(?:www\.)?plurk\.com/[\w_]+)',
    }
    for key, pat in patterns.items():
        m = re.search(pat, desc, re.IGNORECASE)
        if m:
            socials[key] = m.group(1)
    return socials


def yt_search_channels(query, api_key):
    params = {
        'part': 'snippet',
        'type': 'channel',
        'q': query,
        'order': 'date',
        'maxResults': 25,
        'key': api_key,
    }
    r = session.get('https://www.googleapis.com/youtube/v3/search', params=params, timeout=20)
    if r.status_code >= 400:
        return [], r.json()
    data = r.json()
    ids = [item['id']['channelId'] for item in data.get('items', []) if item.get('id', {}).get('channelId')]
    return ids, None


def yt_channels_details(channel_ids, api_key):
    out = []
    for i in range(0, len(channel_ids), 50):
        chunk = channel_ids[i:i+50]
        params = {
            'part': 'snippet,statistics',
            'id': ','.join(chunk),
            'key': api_key,
        }
        r = session.get('https://www.googleapis.com/youtube/v3/channels', params=params, timeout=20)
        if r.status_code >= 400:
            break
        data = r.json()
        out.extend(data.get('items', []))
        time.sleep(0.2)
    return out


def should_keep(title, desc):
    text = f"{title} {desc}".lower()
    return any(k in text for k in KEYWORDS)


def wp_create_or_update(post_id, payload):
    if post_id:
        url = f'{WP_BASE}/vtuber/{post_id}'
        r = session.post(url, json=payload, auth=(WP_USER, WP_PASS), timeout=20)
    else:
        url = f'{WP_BASE}/vtuber'
        r = session.post(url, json=payload, auth=(WP_USER, WP_PASS), timeout=20)
    r.raise_for_status()
    return r.json()


def main():
    if not WP_USER or not WP_PASS:
        print({'error': 'missing USADA_WP_USER/USADA_WP_PASS'})
        return
    if not YT_KEYS:
        print({'error': 'missing USADA_YT_API_KEYS'})
        return

    existing = wp_get_all_vtubers()
    by_yt = {}
    by_title = {}
    for item in existing:
        meta = item.get('meta', {}) or {}
        yt_url = meta.get('vt_youtube_url') or ''
        key = normalize_yt(yt_url)
        if key:
            by_yt[key] = item['id']
        title = item.get('title', {}).get('rendered', '')
        if title:
            by_title[title.strip().lower()] = item['id']

    api_key = None
    for key in YT_KEYS:
        ids, err = yt_search_channels('VTuber', key)
        if not err:
            api_key = key
            break
    if not api_key:
        print({'error': 'no valid youtube key'})
        return

    candidate_ids = []
    for q in QUERIES:
        ids, err = yt_search_channels(q, api_key)
        if err:
            continue
        candidate_ids.extend(ids)
    candidate_ids = list(dict.fromkeys(candidate_ids))[:MAX_CHANNELS]
    details = yt_channels_details(candidate_ids, api_key)

    created = 0
    updated = 0
    skipped = 0
    processed = 0

    for ch in details:
        if processed >= MAX_UPDATES:
            break
        cid = ch['id']
        snippet = ch.get('snippet', {})
        stats = ch.get('statistics', {})
        title = snippet.get('title', '').strip()
        desc = snippet.get('description', '').strip()
        if not title:
            continue
        if not should_keep(title, desc):
            skipped += 1
            continue

        yt_url = f'https://www.youtube.com/channel/{cid}'
        handle = snippet.get('customUrl')
        if handle and not handle.startswith('@'):
            handle = '@' + handle

        keys = [normalize_yt(yt_url)]
        if handle:
            keys.append(normalize_yt(f'https://www.youtube.com/{handle}'))

        post_id = 0
        for k in keys:
            if k in by_yt:
                post_id = by_yt[k]
                break
        if not post_id and title.strip().lower() in by_title:
            post_id = by_title[title.strip().lower()]

        thumbs = snippet.get('thumbnails', {})
        thumb = thumbs.get('high', {}).get('url') or thumbs.get('medium', {}).get('url') or thumbs.get('default', {}).get('url') or ''

        meta = {
            'vt_youtube_url': yt_url,
            'vt_youtube_subs': int(stats.get('subscriberCount') or 0),
        }
        if thumb:
            meta['vt_thumb_url'] = thumb
        if desc:
            meta['vt_summary'] = desc[:800]

        socials = extract_socials(desc)
        for k, v in socials.items():
            if v:
                meta[k] = v

        payload = {
            'title': title,
            'status': 'publish',
            'meta': meta,
        }
        if not post_id:
            payload['meta']['vt_display_b64'] = base64.b64encode(title.encode('utf-8')).decode('utf-8')
        try:
            wp_create_or_update(post_id, payload)
            processed += 1
            if post_id:
                updated += 1
            else:
                created += 1
        except Exception:
            continue

    report = {
        'created': created,
        'updated': updated,
        'skipped': skipped,
        'processed': processed,
        'candidates': len(details),
        'api_key_used': 'configured',
    }
    with open('latest_vtuber_update_report.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(report)


if __name__ == '__main__':
    main()
