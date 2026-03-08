import argparse
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def read_key():
    s = open('vt-maint.php', 'r', encoding='utf-8', errors='ignore').read()
    m = re.search(r'\$secret\s*=\s*"([^"]+)"', s)
    if not m:
        raise SystemExit('secret_not_found')
    return m.group(1)


def fetch(url, timeout=120):
    req = urllib.request.Request(url, headers={'User-Agent': 'vt-maint-client/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def parse_action_item(item):
    """
    Examples:
      status
      missing sample=1200
      avatar_diagnose_raw sample=8000 timeout=300
    """
    item = (item or '').strip()
    if not item:
        return None
    parts = item.split()
    action = parts[0].strip()
    timeout = None
    extra_qs = []
    for p in parts[1:]:
        if '=' not in p:
            continue
        k, v = p.split('=', 1)
        k = k.strip()
        v = v.strip()
        if k == 'timeout':
            try:
                timeout = int(v)
            except Exception:
                timeout = None
        else:
            extra_qs.append((k, v))
    return action, timeout, extra_qs


def build_url(base, key, action, extra_qs=None):
    qs = [('key', key), ('action', action)]
    if extra_qs:
        qs.extend(extra_qs)
    return f'{base}?{urllib.parse.urlencode(qs)}'


def main():
    key = read_key()
    base = 'https://usadanews.com/vt-maint.php'
    default_actions = [
        ('source_health_raw', 240, []),
        ('sync_sheet_force', 240, []),
        ('cleanup_terms', 120, []),
        ('enrich_terms', 180, []),
        ('fillthumbs', 240, []),
        ('assign_default_lang', 180, []),
        ('ensure_translations', 240, []),
        # Keep news refresh batch small to avoid transient origin timeout.
        ('news_refresh', 240, [('batch', '6')]),
        ('avatar_diagnose_raw', 240, []),
    ]

    ap = argparse.ArgumentParser()
    ap.add_argument(
        '--actions',
        nargs='*',
        default=None,
        help='Actions to run. Example: --actions status "missing sample=1200"',
    )
    ap.add_argument(
        '--timeout-default',
        type=int,
        default=180,
        help='Default timeout for CLI actions (seconds)',
    )
    args = ap.parse_args()

    if args.actions:
        actions = []
        for raw in args.actions:
            parsed = parse_action_item(raw)
            if not parsed:
                continue
            act, timeout, extra_qs = parsed
            actions.append((act, int(timeout or args.timeout_default), extra_qs))
    else:
        actions = default_actions

    os.makedirs('reports', exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    log_path = os.path.join('reports', f'maint_actions_{ts}.log')

    with open(log_path, 'w', encoding='utf-8') as log:
        log.write(f'utc={datetime.now(timezone.utc).isoformat()}\n')
        for act, to, extra_qs in actions:
            url = build_url(base, key, act, extra_qs)
            t0 = time.time()
            try:
                body = fetch(url, timeout=to)
                dt = time.time() - t0
                txt = body.decode('utf-8-sig', 'ignore')
                log.write('\n' + '=' * 60 + '\n')
                log.write(f'action={act} seconds={dt:.1f} url={url}\n')
                log.write(txt.strip() + '\n')
                print('ok', act, f'{dt:.1f}s')
            except Exception as e:
                dt = time.time() - t0
                log.write('\n' + '=' * 60 + '\n')
                log.write(f'action={act} seconds={dt:.1f} url={url} ERROR {e}\n')
                print('err', act, e)

    print('log', log_path)


if __name__ == '__main__':
    main()
