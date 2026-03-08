<?php
// VT status dashboard (Basic Auth or ?key=...)
$secret = getenv('VT_MAINT_KEY') ?: '__SET_ME__';
$basic_user = getenv('VT_MAINT_USER') ?: '__SET_ME__';
$basic_pass = getenv('VT_MAINT_PASS') ?: '__SET_ME__';

ini_set('display_errors', '0');
error_reporting(E_ALL);

// Minimal fatal logger for this standalone script.
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        @file_put_contents(__DIR__ . '/vt-status-fatal.log', gmdate('c') . ' ' . ($e['message'] ?? '') . ' in ' . ($e['file'] ?? '') . ':' . ($e['line'] ?? '') . "\n", FILE_APPEND);
    }
});

header('X-Robots-Tag: noindex, nofollow', true);

$authorized = false;
if (isset($_GET['key']) && hash_equals($secret, (string) $_GET['key'])) {
    $authorized = true;
} elseif (isset($_SERVER['PHP_AUTH_USER'], $_SERVER['PHP_AUTH_PW']) && $_SERVER['PHP_AUTH_USER'] === $basic_user && $_SERVER['PHP_AUTH_PW'] === $basic_pass) {
    $authorized = true;
}

if (!$authorized) {
    header('WWW-Authenticate: Basic realm="VT Status"', true, 401);
    exit('forbidden');
}

$wp_load = __DIR__ . '/wp-load.php';
if (!file_exists($wp_load)) {
    http_response_code(500);
    exit('wp-load.php not found');
}
require_once $wp_load;

function vt_tail($file, $lines = 20) {
    if (!file_exists($file)) return 'no log';
    $arr = @file($file);
    if (!$arr) return 'no log';
    $slice = array_slice($arr, -1 * $lines);
    return implode('', $slice);
}

function vt_parse_css_vars($txt) {
    $vars = [];
    if (!$txt) return $vars;
    if (preg_match_all('/--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/', $txt, $m, PREG_SET_ORDER)) {
        foreach ($m as $row) {
            $vars['--' . $row[1]] = trim($row[2]);
        }
    }
    return $vars;
}

function vt_parse_color_to_rgb($val) {
    $val = trim((string) $val);
    if ($val === '') return null;

    if (preg_match('/^#([0-9a-fA-F]{3})$/', $val, $m)) {
        $h = $m[1];
        return [hexdec($h[0] . $h[0]), hexdec($h[1] . $h[1]), hexdec($h[2] . $h[2])];
    }
    if (preg_match('/^#([0-9a-fA-F]{6})$/', $val, $m)) {
        $h = $m[1];
        return [hexdec(substr($h, 0, 2)), hexdec(substr($h, 2, 2)), hexdec(substr($h, 4, 2))];
    }

    if (preg_match('/^rgba?\(([^\)]+)\)$/i', $val, $m)) {
        $parts = array_map('trim', explode(',', $m[1]));
        if (count($parts) >= 3) return [intval($parts[0]), intval($parts[1]), intval($parts[2])];
    }

    return null;
}

function vt_rel_lum($rgb) {
    $srgb = [];
    foreach ([0, 1, 2] as $i) {
        $c = max(0.0, min(1.0, $rgb[$i] / 255.0));
        $srgb[$i] = ($c <= 0.03928) ? ($c / 12.92) : pow(($c + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * $srgb[0] + 0.7152 * $srgb[1] + 0.0722 * $srgb[2];
}

function vt_contrast_ratio($rgb_a, $rgb_b) {
    $l1 = vt_rel_lum($rgb_a);
    $l2 = vt_rel_lum($rgb_b);
    if ($l1 < $l2) {
        $t = $l1;
        $l1 = $l2;
        $l2 = $t;
    }
    return ($l1 + 0.05) / ($l2 + 0.05);
}

function vt_ui_sanity() {
    $checks = [];

    if (defined('VT_PORTAL_DIR')) {
        $css = VT_PORTAL_DIR . 'assets/vtuber-portal.css';
        if (file_exists($css)) {
            $txt = file_get_contents($css);
            $checks[] = ['label' => 'CSS: full-viewport background layer', 'ok' => (false !== strpos($txt, 'body.vt-landing::before'))];
            // Newsmatic optional overlay can make desktop look like a small centered "frame".
            $checks[] = ['label' => 'CSS: disable Newsmatic website frame overlay', 'ok' => (false !== strpos($txt, '.newsmatic_website_frame') && false !== stripos($txt, 'display: none !important'))];
            $checks[] = ['label' => 'CSS: single layout fluid 100vw guardrail', 'ok' => (false !== strpos($txt, 'calc(100vw - clamp('))];
            $checks[] = ['label' => 'CSS: container query fallback', 'ok' => (false !== strpos($txt, '@container (max-width: 760px)'))];
            $checks[] = ['label' => 'CSS: desktop single-page width policy', 'ok' => (false !== strpos($txt, '.vt-landing-single .vt-layout {') && false !== strpos($txt, 'var(--vt-shell-wide)'))];
            $checks[] = ['label' => 'CSS: single page escapes theme container', 'ok' => (false !== strpos($txt, '.vt-landing-single #content'))];
            $checks[] = ['label' => 'CSS: desktop 2-column switch >=1280px', 'ok' => (false !== strpos($txt, '@media (min-width: 1280px)'))];
            $checks[] = ['label' => 'CSS: standard breakpoint set', 'ok' => (false !== strpos($txt, '@media (min-width: 768px)') && false !== strpos($txt, '@media (min-width: 1024px)') && false !== strpos($txt, '@media (min-width: 1280px)') && false !== strpos($txt, '@media (min-width: 1536px)'))];

            // Heuristic regression check: CTA section should not use dark text on dark background.
            $checks[] = ['label' => 'CSS: CTA text not dark-on-dark', 'ok' => (1 !== preg_match('/\\.vt-cta\\s+h3\\s*\\{[^}]*color\\s*:\\s*#0b1220/i', $txt))];
            $checks[] = ['label' => 'CSS: section text readability override', 'ok' => (false !== strpos($txt, 'body.vt-landing .vt-section-neo h2'))];
        } else {
            $checks[] = ['label' => 'CSS file exists', 'ok' => false];
        }

        $checks[] = ['label' => 'Template: single-vtuber override exists', 'ok' => file_exists(VT_PORTAL_DIR . 'templates/single-vtuber.php')];
    } else {
        $checks[] = ['label' => 'VT_PORTAL_DIR defined', 'ok' => false];
    }

    return $checks;
}

function vt_load_site_audit() {
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/site-audit.json';
    if (!file_exists($file)) return null;
    $txt = file_get_contents($file);
    if (!$txt) return null;
    $j = json_decode($txt, true);
    if (!is_array($j)) return null;
    return $j;
}

function vt_load_sheet_sync() {
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/sheet-sync-last.json';
    if (!file_exists($file)) return null;
    $txt = file_get_contents($file);
    if (!$txt) return null;
    $j = json_decode($txt, true);
    if (!is_array($j)) return null;
    return $j;
}

function vt_load_sheet_unmatched() {
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/sheet-sync-unmatched.json';
    if (!file_exists($file)) return [];
    $txt = file_get_contents($file);
    if (!$txt) return [];
    $j = json_decode($txt, true);
	return is_array($j) ? $j : [];
}

function vt_load_sheet_missing_avatar() {
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/sheet-sync-missing-avatar.json';
    if (!file_exists($file)) return [];
    $txt = file_get_contents($file);
    if (!$txt) return [];
    $j = json_decode($txt, true);
    return is_array($j) ? $j : [];
}

function vt_load_global_import() {
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/global-import-last.json';
    if (!file_exists($file)) return null;
    $txt = file_get_contents($file);
    if (!$txt) return null;
    $j = json_decode($txt, true);
    if (!is_array($j)) return null;
    return $j;
}

function vt_load_backup_readiness() {
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/backup-readiness.json';
    if (!file_exists($file)) return null;
    $txt = file_get_contents($file);
    if (!$txt) return null;
    $j = json_decode($txt, true);
    return is_array($j) ? $j : null;
}

function vt_load_json_report($name) {
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/' . ltrim((string) $name, '/');
    if (!file_exists($file)) return null;
    $txt = file_get_contents($file);
    if (!$txt) return null;
    $j = json_decode($txt, true);
    return is_array($j) ? $j : null;
}

function vt_contrast_checks() {
    if (!defined('VT_PORTAL_DIR')) {
        return [['label' => 'Contrast: VT_PORTAL_DIR defined', 'ok' => false, 'detail' => 'missing']];
    }

    $css = VT_PORTAL_DIR . 'assets/vtuber-portal.css';
    if (!file_exists($css)) {
        return [['label' => 'Contrast: vtuber-portal.css exists', 'ok' => false, 'detail' => 'missing file']];
    }

    $txt  = file_get_contents($css);
    $vars = vt_parse_css_vars($txt);

    $text_colors = [
        ['name' => '--vt-ink',   'min' => 4.5],
        ['name' => '--vt-muted', 'min' => 3.0],
    ];
    $bg_colors = ['--vt-bg', '--vt-panel', '--vt-surface', '--vt-card'];

    $checks = [];
    foreach ($text_colors as $tc) {
        $tname = $tc['name'];
        $tval  = $vars[$tname] ?? null;
        $trgb  = vt_parse_color_to_rgb($tval);
        if (!$trgb) {
            $checks[] = ['label' => "Contrast: $tname parse", 'ok' => false, 'detail' => (string) $tval];
            continue;
        }

        foreach ($bg_colors as $bname) {
            $bval = $vars[$bname] ?? null;
            $brgb = vt_parse_color_to_rgb($bval);
            if (!$brgb) {
                $checks[] = ['label' => "Contrast: $tname on $bname parse", 'ok' => false, 'detail' => (string) $bval];
                continue;
            }

            $ratio = vt_contrast_ratio($trgb, $brgb);
            $ok    = ($ratio >= $tc['min']);
            $checks[] = [
                'label'  => "Contrast: $tname on $bname",
                'ok'     => $ok,
                'detail' => sprintf('%.2f (min %.1f)', $ratio, $tc['min']),
            ];
        }
    }

    return $checks;
}

function vt_top_terms($taxonomy, $limit = 10) {
    $terms = get_terms([
        'taxonomy'   => $taxonomy,
        'hide_empty' => true,
        'orderby'    => 'count',
        'order'      => 'DESC',
        'number'     => $limit,
    ]);
    if (is_wp_error($terms) || empty($terms)) return [];
    $out = [];
    foreach ($terms as $t) {
        $out[] = ['name' => $t->name, 'count' => intval($t->count), 'slug' => $t->slug];
    }
    return $out;
}

function vt_missing_taxonomy_count($taxonomy) {
    $q = new WP_Query([
        'post_type'      => 'vtuber',
        'post_status'    => 'publish',
        'posts_per_page' => 1,
        'fields'         => 'ids',
        'tax_query'      => [
            [
                'taxonomy' => $taxonomy,
                'operator' => 'NOT EXISTS',
            ],
        ],
    ]);
    return intval($q->found_posts);
}

$total = wp_count_posts('vtuber')->publish;
$missing_q = new WP_Query([
    'post_type'      => 'vtuber',
    'posts_per_page' => 1,
    'fields'         => 'ids',
    'no_found_rows'  => true,
    'meta_query'     => [
        ['key' => '_thumbnail_id', 'compare' => 'NOT EXISTS'],
    ],
]);
$missing = $missing_q->found_posts;

$next = wp_next_scheduled('vt_maint_fillthumbs_event');

$log1 = vt_tail(WP_CONTENT_DIR . '/uploads/vt-logs/maint-runner.log', 25);
$log2 = vt_tail(WP_CONTENT_DIR . '/uploads/vt-logs/maint-log.txt', 25);
$time = gmdate('Y-m-d H:i:s');
$ui_checks = vt_ui_sanity();
$contrast_checks = vt_contrast_checks();
$agency_top = vt_top_terms('agency', 8);
$platform_top = vt_top_terms('platform', 8);
$role_top = vt_top_terms('role-tag', 8);
$life_top = vt_top_terms('life-status', 8);
$agency_missing = vt_missing_taxonomy_count('agency');
$platform_missing = vt_missing_taxonomy_count('platform');
$role_missing = vt_missing_taxonomy_count('role-tag');
$life_missing = vt_missing_taxonomy_count('life-status');
$site_audit = vt_load_site_audit();
$sheet_sync = vt_load_sheet_sync();
$sheet_unmatched = vt_load_sheet_unmatched();
$sheet_missing_avatar = vt_load_sheet_missing_avatar();
$global_import = vt_load_global_import();
$backup_readiness = vt_load_backup_readiness();
$avatar_diag = vt_load_json_report('avatar-diagnose.json');
$news_last = vt_load_json_report('news-refresh-last.json');
$suggest_total = 0;
$suggest_new = 0;
if (post_type_exists('vt-suggestion')) {
    $suggest_total = intval(wp_count_posts('vt-suggestion')->publish ?? 0);
    $sq = new WP_Query([
        'post_type' => 'vt-suggestion',
        'post_status' => 'publish',
        'posts_per_page' => 1,
        'date_query' => [[ 'after' => '7 days ago' ]],
        'fields' => 'ids',
    ]);
    $suggest_new = intval($sq->found_posts);
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>VT Maint Status</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e2e8f0;padding:24px;line-height:1.6;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start;}
  .card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.2);}
  h1{font-size:22px;margin:0 0 10px;}
  h2{font-size:16px;margin:0 0 10px;}
  .meta{color:#94a3b8;font-size:13px;margin:0 0 10px;}
  .mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;white-space:pre-wrap;background:#0b1220;padding:12px;border-radius:8px;border:1px solid #1f2937;color:#cbd5e1;overflow:auto;}
  a.btn{display:inline-block;padding:8px 12px;margin:6px 8px 0 0;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;}
  a.btn:hover{background:#1d4ed8;}
  .ok{color:#22c55e;font-weight:800;}
  .bad{color:#ef4444;font-weight:800;}
  .row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;}
</style>
</head>
<body>
  <h1>VT Maint Status</h1>
  <p class="meta">UTC: <?php echo esc_html($time); ?></p>

  <div class="grid">
    <div class="card">
      <h2>Overview</h2>
      <div class="row"><div>VTubers total</div><div><b><?php echo esc_html(number_format_i18n($total)); ?></b></div></div>
      <div class="row"><div>Missing thumbs (sampled)</div><div><b><?php echo esc_html(number_format_i18n($missing)); ?></b></div></div>
      <div class="row"><div>Next auto fill</div><div><b><?php echo $next ? esc_html(gmdate('Y-m-d H:i:s', $next)) : 'not scheduled'; ?></b></div></div>
      <div class="row"><div>DISABLE_WP_CRON</div><div><b><?php echo defined('DISABLE_WP_CRON') && DISABLE_WP_CRON ? 'true' : 'false'; ?></b></div></div>
      <div class="row"><div>Suggestions total</div><div><b><?php echo esc_html(number_format_i18n($suggest_total)); ?></b></div></div>
      <div class="row"><div>Suggestions (7d)</div><div><b><?php echo esc_html(number_format_i18n($suggest_new)); ?></b></div></div>
      <div style="margin-top:10px;">
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=status">Plain status</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=fillthumbs">Run fillthumbs (20)</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=enrich_terms">Run enrich_terms (50)</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=sync_sheet">Run sync_sheet</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=cleanup_terms">Cleanup bad terms</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=opcache">Invalidate opcache</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=ensure_pages">Ensure pages</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=missing">Missing list</a>
      </div>
    </div>

    <div class="card">
      <h2>Sheet Sync</h2>
      <p class="meta">Google Sheet lifecycle + metadata sync status.</p>
      <?php if (is_array($sheet_sync)) : ?>
        <div class="row"><div>Last run (UTC)</div><div><b><?php echo esc_html($sheet_sync['utc'] ?? 'unknown'); ?></b></div></div>
        <div class="row"><div>Rows</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['rows'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Mapped</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['mapped'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Matched Existing</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['matched_existing'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Created</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['created'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Updated</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['updated'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Avatar Updated</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['avatar_updates'] ?? 0))); ?></b></div></div>
        <div class="row"><div>YouTube API fill</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['api_refreshed_yt'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Twitch API fill</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['api_refreshed_tw'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Unmatched</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['unmatched'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Stale (not in sheet)</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['stale'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Missing avatar (after sync)</div><div><b><?php echo esc_html(number_format_i18n(intval($sheet_sync['missing_avatar'] ?? count($sheet_missing_avatar)))); ?></b></div></div>
        <?php if (!empty($sheet_sync['sources']) && is_array($sheet_sync['sources'])) : ?>
          <div class="meta" style="margin-top:8px;">Source tabs</div>
          <?php foreach ($sheet_sync['sources'] as $src): ?>
            <div class="row">
              <div><?php echo esc_html((string)($src['label'] ?? 'unknown')); ?></div>
              <div><b><?php echo esc_html(number_format_i18n(intval($src['mapped'] ?? 0))); ?></b><span class="meta"> / <?php echo esc_html(number_format_i18n(intval($src['rows'] ?? 0))); ?></span></div>
            </div>
            <?php if (!empty($src['error'])): ?>
              <div class="meta">error: <?php echo esc_html((string)$src['error']); ?></div>
            <?php endif; ?>
          <?php endforeach; ?>
        <?php endif; ?>
        <?php if (!empty($sheet_unmatched)) : ?>
          <div class="meta" style="margin-top:8px;">Unmatched sample</div>
          <?php $n = 0; foreach ($sheet_unmatched as $it): if ($n >= 8) break; $n++; ?>
            <div><?php echo esc_html((string)($it['title'] ?? '')); ?> <span class="meta"><?php echo esc_html((string)($it['error'] ?? ($it['id'] ?? ''))); ?></span></div>
          <?php endforeach; ?>
        <?php endif; ?>
      <?php else : ?>
        <div class="meta">No sheet sync report yet.</div>
      <?php endif; ?>
      <div style="margin-top:10px;">
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=sync_sheet">Run sync_sheet</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=sync_sheet_force">Run sync_sheet_force</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=unlock_sync">Unlock sync lock</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=reschedule_maint">Reschedule maint cron</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=sheet_report">Sheet report JSON</a>
      </div>
    </div>

    <div class="card">
      <h2>Global Import</h2>
      <p class="meta">Foreign database ingest (Fandom categories: Hololive/Nijisanji/VShojo).</p>
      <?php if (is_array($global_import)) : ?>
        <div class="row"><div>Last run (UTC)</div><div><b><?php echo esc_html($global_import['utc'] ?? 'unknown'); ?></b></div></div>
        <div class="row"><div>Source</div><div><b><?php echo esc_html($global_import['source'] ?? ''); ?></b></div></div>
        <div class="row"><div>Processed</div><div><b><?php echo esc_html(number_format_i18n(intval($global_import['processed'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Created</div><div><b><?php echo esc_html(number_format_i18n(intval($global_import['created'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Updated</div><div><b><?php echo esc_html(number_format_i18n(intval($global_import['updated'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Skipped</div><div><b><?php echo esc_html(number_format_i18n(intval($global_import['skipped'] ?? 0))); ?></b></div></div>
      <?php else : ?>
        <div class="meta">No global import report yet.</div>
      <?php endif; ?>
      <div style="margin-top:10px;">
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=import_global&limit=36">Run import_global (36)</a>
      </div>
    </div>

    <div class="card">
      <h2>Taxonomy</h2>
      <p class="meta">Tag enrichment health (hide empty terms; top terms by usage).</p>
      <div class="row"><div>Missing agency</div><div><b><?php echo esc_html(number_format_i18n($agency_missing)); ?></b></div></div>
      <div class="row"><div>Missing platform</div><div><b><?php echo esc_html(number_format_i18n($platform_missing)); ?></b></div></div>
      <div class="row"><div>Missing role-tag</div><div><b><?php echo esc_html(number_format_i18n($role_missing)); ?></b></div></div>
      <div class="row"><div>Missing life-status</div><div><b><?php echo esc_html(number_format_i18n($life_missing)); ?></b></div></div>
      <div style="margin-top:10px;">
        <div class="meta">Top agency</div>
        <?php foreach ($agency_top as $t): ?>
          <div><?php echo esc_html($t['name']); ?> <span class="meta"><?php echo esc_html('(' . number_format_i18n($t['count']) . ')'); ?></span></div>
        <?php endforeach; ?>
      </div>
      <div style="margin-top:10px;">
        <div class="meta">Top platform</div>
        <?php foreach ($platform_top as $t): ?>
          <div><?php echo esc_html($t['name']); ?> <span class="meta"><?php echo esc_html('(' . number_format_i18n($t['count']) . ')'); ?></span></div>
        <?php endforeach; ?>
      </div>
      <div style="margin-top:10px;">
        <div class="meta">Top role-tag</div>
        <?php foreach ($role_top as $t): ?>
          <div><?php echo esc_html($t['name']); ?> <span class="meta"><?php echo esc_html('(' . number_format_i18n($t['count']) . ')'); ?></span></div>
        <?php endforeach; ?>
      </div>
      <div style="margin-top:10px;">
        <div class="meta">Top life-status</div>
        <?php foreach ($life_top as $t): ?>
          <div><?php echo esc_html($t['name']); ?> <span class="meta"><?php echo esc_html('(' . number_format_i18n($t['count']) . ')'); ?></span></div>
        <?php endforeach; ?>
      </div>
    </div>

    <div class="card">
      <h2>Site Audit</h2>
      <p class="meta">End-to-end checks to catch pages still linking to old UI or missing components.</p>
      <?php if (is_array($site_audit)) : ?>
        <div class="row"><div>Last run (UTC)</div><div><b><?php echo esc_html($site_audit['utc'] ?? 'unknown'); ?></b></div></div>
        <div class="row"><div>Pass</div><div><b><?php echo esc_html(number_format_i18n(intval($site_audit['pass'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Fail</div><div><b><?php echo esc_html(number_format_i18n(intval($site_audit['fail'] ?? 0))); ?></b></div></div>
        <?php if (!empty($site_audit['layout_audit']) && is_array($site_audit['layout_audit'])) : ?>
          <div class="row">
            <div>Layout audit</div>
            <div>
              <?php if (!empty($site_audit['layout_audit']['ok'])) : ?>
                <span class="ok">OK</span>
              <?php else : ?>
                <span class="bad">FAIL</span>
              <?php endif; ?>
            </div>
          </div>
          <?php if (!empty($site_audit['layout_audit']['metrics']) && is_array($site_audit['layout_audit']['metrics'])) : ?>
            <div style="margin-top:8px;">
              <div class="meta">Layout metrics</div>
              <?php foreach ($site_audit['layout_audit']['metrics'] as $m) : ?>
                <div>
                  <?php if (!empty($m['ok'])) : ?>
                    <span class="ok">OK</span>
                  <?php else : ?>
                    <span class="bad">FAIL</span>
                  <?php endif; ?>
                  <?php echo esc_html((string) ($m['name'] ?? 'metric')); ?>
                  <span class="meta"><?php echo esc_html(' = ' . strval($m['value'] ?? '')); ?></span>
                </div>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>
        <?php endif; ?>
        <?php if (!empty($site_audit['i18n_audit']) && is_array($site_audit['i18n_audit'])) : ?>
          <div class="row" style="margin-top:8px;">
            <div>i18n SEO audit</div>
            <div><?php echo !empty($site_audit['i18n_audit']['ok']) ? '<span class="ok">OK</span>' : '<span class="bad">FAIL</span>'; ?></div>
          </div>
          <div class="row"><div>Languages detected</div><div><b><?php echo esc_html(number_format_i18n(intval($site_audit['i18n_audit']['langs_count'] ?? 0))); ?></b></div></div>
          <div class="row"><div>Home hreflang/canonical</div><div><?php echo !empty($site_audit['i18n_audit']['home']['ok']) ? '<span class="ok">OK</span>' : '<span class="bad">FAIL</span>'; ?></div></div>
          <div class="row"><div>Single hreflang/canonical</div><div><?php echo !empty($site_audit['i18n_audit']['single']['ok']) ? '<span class="ok">OK</span>' : '<span class="bad">FAIL</span>'; ?></div></div>
        <?php endif; ?>
        <?php if (!empty($site_audit['targets']) && is_array($site_audit['targets'])) : ?>
          <div style="margin-top:10px;">
            <?php foreach ($site_audit['targets'] as $t) : ?>
              <div>
                <?php if (!empty($t['ok'])) : ?>
                  <span class="ok">OK</span>
                <?php else : ?>
                  <span class="bad">FAIL</span>
                <?php endif; ?>
                <?php echo esc_html($t['name'] ?? ''); ?>
                <span class="meta"><?php echo esc_html('(' . intval($t['code'] ?? 0) . ')'); ?></span>
              </div>
            <?php endforeach; ?>
          </div>
        <?php endif; ?>
        <?php if (!empty($site_audit['crawl']) && is_array($site_audit['crawl'])) : ?>
          <div style="margin-top:10px;">
            <div class="meta">Crawl sample</div>
            <div class="row"><div>Checked</div><div><b><?php echo esc_html(number_format_i18n(intval($site_audit['crawl']['checked'] ?? 0))); ?></b></div></div>
            <div class="row"><div>Pass</div><div><b><?php echo esc_html(number_format_i18n(intval($site_audit['crawl']['pass'] ?? 0))); ?></b></div></div>
            <div class="row"><div>Fail</div><div><b><?php echo esc_html(number_format_i18n(intval($site_audit['crawl']['fail'] ?? 0))); ?></b></div></div>
            <?php
            $shown_fail = 0;
            if (!empty($site_audit['crawl']['items']) && is_array($site_audit['crawl']['items'])) :
              foreach ($site_audit['crawl']['items'] as $ci) :
                if (!empty($ci['ok'])) continue;
                if ($shown_fail >= 8) break;
                $shown_fail++;
                ?>
                <div><span class="bad">FAIL</span> <?php echo esc_html((string) ($ci['url'] ?? '')); ?> <span class="meta"><?php echo esc_html((string) ($ci['reason'] ?? '')); ?></span></div>
              <?php
              endforeach;
            endif;
            ?>
          </div>
        <?php endif; ?>
        <?php if (!empty($site_audit['legacy_links']) && is_array($site_audit['legacy_links'])) : ?>
          <div style="margin-top:10px;">
            <div class="meta">Legacy links in portal pages</div>
            <div class="row"><div>Count</div><div><b><?php echo esc_html(number_format_i18n(intval($site_audit['legacy_links']['count'] ?? 0))); ?></b></div></div>
            <?php
            $shown_legacy = 0;
            if (!empty($site_audit['legacy_links']['items']) && is_array($site_audit['legacy_links']['items'])) :
              foreach ($site_audit['legacy_links']['items'] as $li) :
                if ($shown_legacy >= 8) break;
                $shown_legacy++;
                ?>
                <div><span class="bad">LEGACY</span> <?php echo esc_html((string) ($li['url'] ?? '')); ?></div>
              <?php
              endforeach;
            endif;
            ?>
          </div>
        <?php endif; ?>
      <?php else : ?>
        <div class="meta">No audit report yet.</div>
      <?php endif; ?>

      <div style="margin-top:10px;">
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=site_audit">Run site_audit</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=site_audit_raw">View raw JSON</a>
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=backup_readiness">Run backup_readiness</a>
      </div>
    </div>

    <div class="card">
      <h2>GitHub Backup Readiness</h2>
      <p class="meta">Pre-push guardrail for private repository backup.</p>
      <?php if (is_array($backup_readiness)) : ?>
        <div class="row"><div>Last run (UTC)</div><div><b><?php echo esc_html($backup_readiness['utc'] ?? 'unknown'); ?></b></div></div>
        <div class="row">
          <div>Status</div>
          <div><?php echo !empty($backup_readiness['ok']) ? '<span class="ok">OK</span>' : '<span class="bad">CHECK</span>'; ?></div>
        </div>
        <div class="row"><div>Issues</div><div><b><?php echo esc_html(number_format_i18n(count((array)($backup_readiness['issues'] ?? [])))); ?></b></div></div>
        <?php
        $shown = 0;
        foreach ((array)($backup_readiness['issues'] ?? []) as $it) :
          if ($shown >= 8) break;
          $shown++;
          ?>
          <div>
            <?php echo (($it['severity'] ?? '') === 'error') ? '<span class="bad">ERROR</span>' : '<span class="bad">WARN</span>'; ?>
            <?php echo esc_html((string)($it['type'] ?? 'issue')); ?>
            <?php if (!empty($it['file'])) : ?><span class="meta"><?php echo esc_html(' ' . (string)$it['file']); ?></span><?php endif; ?>
            <?php if (!empty($it['rule'])) : ?><span class="meta"><?php echo esc_html(' rule=' . (string)$it['rule']); ?></span><?php endif; ?>
          </div>
        <?php endforeach; ?>
      <?php else : ?>
        <div class="meta">No backup readiness report yet.</div>
      <?php endif; ?>
    </div>

    <div class="card">
      <h2>Avatar Diagnose</h2>
      <?php if (is_array($avatar_diag)) : ?>
        <div class="row"><div>Last run</div><div><b><?php echo esc_html($avatar_diag['utc'] ?? 'unknown'); ?></b></div></div>
        <div class="row"><div>Checked</div><div><b><?php echo esc_html(number_format_i18n(intval($avatar_diag['checked'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Need fix</div><div><b><?php echo esc_html(number_format_i18n(intval($avatar_diag['need_fix'] ?? 0))); ?></b></div></div>
      <?php else : ?>
        <div class="meta">No avatar diagnose report yet.</div>
      <?php endif; ?>
      <div style="margin-top:10px;">
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=avatar_diagnose">Run avatar_diagnose</a>
      </div>
    </div>

    <div class="card">
      <h2>News Refresh</h2>
      <?php if (is_array($news_last)) : ?>
        <div class="row"><div>Last run</div><div><b><?php echo esc_html($news_last['utc'] ?? 'unknown'); ?></b></div></div>
        <div class="row"><div>Batch</div><div><b><?php echo esc_html(number_format_i18n(intval($news_last['batch'] ?? 0))); ?></b></div></div>
        <div class="row"><div>Total keywords</div><div><b><?php echo esc_html(number_format_i18n(intval($news_last['total'] ?? 0))); ?></b></div></div>
      <?php else : ?>
        <div class="meta">No news refresh report yet.</div>
      <?php endif; ?>
      <div style="margin-top:10px;">
        <a class="btn" href="/vt-maint.php?key=<?php echo urlencode($secret); ?>&action=news_refresh">Run news_refresh</a>
      </div>
    </div>

    <div class="card">
      <h2>UI Sanity</h2>
      <p class="meta">Guardrails to prevent narrow centered layout / white background regressions.</p>
      <?php foreach ($ui_checks as $c): ?>
        <div><?php echo !empty($c['ok']) ? '<span class="ok">OK</span>' : '<span class="bad">FAIL</span>'; ?> <?php echo esc_html($c['label']); ?></div>
      <?php endforeach; ?>
      <p class="meta" style="margin-top:10px;">If FAIL, it's usually CSS cache or a theme boxed/narrow layout override.</p>
    </div>

    <div class="card">
      <h2>Contrast</h2>
      <p class="meta">Automatic readability check (WCAG contrast ratio) for key text/background tokens.</p>
      <?php foreach ($contrast_checks as $c): ?>
        <div>
          <?php echo !empty($c['ok']) ? '<span class="ok">OK</span>' : '<span class="bad">FAIL</span>'; ?>
          <?php echo esc_html($c['label']); ?>
          <?php if (!empty($c['detail'])): ?><span class="meta"><?php echo esc_html(' ' . $c['detail']); ?></span><?php endif; ?>
        </div>
      <?php endforeach; ?>
    </div>

    <div class="card">
      <h2>maint-runner.log (tail)</h2>
      <div class="mono"><?php echo esc_html($log1); ?></div>
    </div>

    <div class="card">
      <h2>maint-log.txt (tail)</h2>
      <div class="mono"><?php echo esc_html($log2); ?></div>
    </div>
  </div>
</body>
</html>

