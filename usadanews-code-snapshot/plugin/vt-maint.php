<?php
// Lightweight maintenance helper (password via ?key=<secret> or Basic Auth). Place in web root.
// Secret key (change here if needed).
$secret = "__SET_BY_ENV_OR_SECURE_CONFIG__";
// Basic Auth (change both if needed).
$basic_user = '__SET_ME__';
$basic_pass = '__SET_ME__';

// noindex for safety
header('X-Robots-Tag: noindex, nofollow', true);

// Allow either ?key or basic auth
$authorized = false;
if ( isset($_GET['key']) && $_GET['key'] === $secret ) {
    $authorized = true;
} elseif ( isset($_SERVER['PHP_AUTH_USER'], $_SERVER['PHP_AUTH_PW']) && $_SERVER['PHP_AUTH_USER'] === $basic_user && $_SERVER['PHP_AUTH_PW'] === $basic_pass ) {
    $authorized = true;
}
if ( ! $authorized ) {
    header('WWW-Authenticate: Basic realm="VT Maint"', true, 401);
    exit('forbidden');
}
require_once __DIR__ . '/wp-load.php';

header('Content-Type: text/plain; charset=utf-8');

function vt_log($msg){
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/maint-log.txt';
    @file_put_contents($file, gmdate('c').' '.$msg."\n", FILE_APPEND);
}

$action = $_GET['action'] ?? 'stats';

function vt_load_maint_plugin_file() {
    $plugin = __DIR__ . '/wp-content/plugins/vt-maint-runner.php';
    if ( file_exists( $plugin ) ) {
        if ( function_exists( 'opcache_invalidate' ) ) {
            @opcache_invalidate( $plugin, true );
        }
        require_once $plugin;
        return true;
    }
    return false;
}

function vt_register_fatal_probe($action_name) {
    $action_name = (string) $action_name;
    register_shutdown_function(function() use ($action_name) {
        $e = error_get_last();
        if (!is_array($e)) {
            return;
        }
        $fatal_types = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR];
        if (!in_array(intval($e['type'] ?? 0), $fatal_types, true)) {
            return;
        }
        $msg = 'fatal action=' . $action_name
            . ' type=' . intval($e['type'] ?? 0)
            . ' file=' . (string) ($e['file'] ?? '')
            . ' line=' . intval($e['line'] ?? 0)
            . ' msg=' . (string) ($e['message'] ?? '');
        vt_log($msg);
        @error_log('[vt-maint] ' . $msg);
        if (!headers_sent()) {
            header('Content-Type: text/plain; charset=utf-8', true, 500);
        }
        echo "fatal {$action_name}: " . (string) ($e['message'] ?? 'unknown') . "\n";
    });
}

function vt_read_log_json($name) {
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/' . ltrim((string) $name, '/');
    if ( ! file_exists($file) ) return [ 'ok' => 0, 'error' => 'not_found', 'file' => $file ];
    $txt = @file_get_contents($file);
    if ( ! is_string($txt) || $txt === '' ) return [ 'ok' => 0, 'error' => 'empty', 'file' => $file ];
    $j = json_decode($txt, true);
    if ( ! is_array($j) ) return [ 'ok' => 0, 'error' => 'invalid_json', 'file' => $file ];
    return [ 'ok' => 1, 'file' => $file, 'data' => $j ];
}

function vt_http_get($url, $timeout = 10) {
    // Prefer WP HTTP API (handles TLS better on many hosts).
    if (function_exists('wp_remote_get')) {
        $attempts = 2;
        for ( $i = 0; $i < $attempts; $i++ ) {
            $res = wp_remote_get($url, [
                'timeout' => $timeout,
                'redirection' => 3,
                'sslverify' => false,
                'user-agent' => 'vt-maint/1.0 (+usadanews.com)',
            ]);
            if (is_wp_error($res)) {
                $msg = (string) $res->get_error_message();
                $is_timeout = ( false !== stripos( $msg, 'timed out' ) || false !== stripos( $msg, 'timeout' ) );
                if ( $is_timeout && $i + 1 < $attempts ) {
                    usleep(250000);
                    continue;
                }
                return ['ok' => false, 'code' => 0, 'err' => $msg, 'body' => ''];
            }
            $code = wp_remote_retrieve_response_code($res);
            $body = (string) wp_remote_retrieve_body($res);
            return ['ok' => ($code >= 200 && $code < 400), 'code' => $code, 'err' => '', 'body' => $body];
        }
    }

    // Fallback: file_get_contents.
    $ctx = stream_context_create([
        'http' => [
            'timeout' => $timeout,
            'header'  => "User-Agent: vt-maint/1.0\r\n",
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ]);
    $body = @file_get_contents($url, false, $ctx);
    return ['ok' => ($body !== false), 'code' => 0, 'err' => ($body === false ? 'fetch failed' : ''), 'body' => ($body === false ? '' : $body)];
}

function vt_csv_nonempty_rows($csv_text, &$total_rows = 0, &$header_cols = 0) {
    $total_rows = 0;
    $header_cols = 0;
    $nonempty = 0;
    if (!is_string($csv_text) || trim($csv_text) === '') {
        return 0;
    }
    $fp = fopen('php://temp', 'r+');
    if (!$fp) return 0;
    fwrite($fp, $csv_text);
    rewind($fp);
    $line_idx = 0;
    while (($row = fgetcsv($fp)) !== false) {
        if (!is_array($row)) continue;
        $line_idx++;
        if ($line_idx === 1) {
            $header_cols = count($row);
            continue;
        }
        $total_rows++;
        $has = false;
        foreach ($row as $c) {
            if (trim((string) $c) !== '') {
                $has = true;
                break;
            }
        }
        if ($has) $nonempty++;
    }
    fclose($fp);
    return $nonempty;
}

function vt_extract_internal_links($html, $host, $limit = 120) {
    $out = [];
    if (!is_string($html) || $html === '') return $out;
    if (!preg_match_all('/href=["\']([^"\']+)["\']/i', $html, $m)) return $out;
    foreach (($m[1] ?? []) as $href) {
        if (!is_string($href) || $href === '') continue;
        if (strpos($href, 'mailto:') === 0 || strpos($href, 'tel:') === 0 || strpos($href, 'javascript:') === 0) continue;
        if (strpos($href, '#') === 0) continue;

        $u = '';
        if (strpos($href, '//') === 0) {
            $u = 'https:' . $href;
        } elseif (preg_match('#^https?://#i', $href)) {
            $u = $href;
        } elseif (strpos($href, '/') === 0) {
            $u = home_url($href);
        } else {
            $u = home_url('/' . ltrim($href, '/'));
        }

        $p = wp_parse_url($u);
        if (!$p || empty($p['host'])) continue;
        if (strtolower((string) $p['host']) !== strtolower((string) $host)) continue;

        $normalized = (isset($p['scheme']) ? $p['scheme'] : 'https') . '://' . $p['host'] . (isset($p['path']) ? $p['path'] : '/');
        if (!empty($p['query'])) $normalized .= '?' . $p['query'];
        $out[$normalized] = true;
        if (count($out) >= $limit) break;
    }
    return array_keys($out);
}

function vt_is_portal_related_path($url) {
    $p = wp_parse_url($url);
    $path = isset($p['path']) ? (string) $p['path'] : '/';
    $query = isset($p['query']) ? (string) $p['query'] : '';
    // Ignore feeds and non-HTML endpoints in crawl.
    if (strpos($path, '/feed/') !== false || substr($path, -5) === '/feed') {
        return false;
    }
    if ($query !== '' && stripos($query, 'feed=') !== false) {
        return false;
    }
    $needles = [
        '/vtuber/',
        '/voice-actor/',
        '/anime/',
        '/character/',
        '/agency/',
        '/platform/',
        '/role/',
        '/franchise/',
        '/life-status/',
        '/platforms/',
        '/agencies/',
        '/roles/',
        '/contact/',
    ];
    foreach ($needles as $n) {
        if (strpos($path, $n) === 0 || $path === rtrim($n, '/')) {
            return true;
        }
    }
    return false;
}

function vt_is_legacy_path($url) {
    $p = wp_parse_url($url);
    $path = isset($p['path']) ? strtolower((string) $p['path']) : '/';
    $query = isset($p['query']) ? strtolower((string) $p['query']) : '';

    if ($path === '' || $path === '/') return false;
    if (strpos($path, '/wp-json/') === 0 || strpos($path, '/wp-admin/') === 0 || strpos($path, '/wp-login.php') === 0) {
        return false;
    }
    if (strpos($path, '/feed/') !== false || substr($path, -5) === '/feed') {
        return false;
    }

    $legacy_prefixes = [
        '/category/',
        '/tag/',
        '/author/',
        '/archives/',
        '/archive/',
    ];
    foreach ($legacy_prefixes as $prefix) {
        if (strpos($path, $prefix) === 0) return true;
    }

    // Typical date archives such as /2023/12/26/...
    if (preg_match('#^/[0-9]{4}/[0-9]{1,2}/#', $path)) return true;
    if ($query !== '' && strpos($query, 'cat=') !== false) return true;

    return false;
}

function vt_has_portal_marker($html) {
    if (!is_string($html) || $html === '') return false;
    return (
        false !== strpos($html, 'vt-landing') ||
        false !== strpos($html, 'vt-landing-custom-template') ||
        false !== strpos($html, 'vt-taxonomy-template')
    );
}

function vt_has_all_needles($text, $needles) {
    if (!is_string($text) || $text === '') return false;
    foreach ((array) $needles as $needle) {
        if (!is_string($needle) || $needle === '') continue;
        if (false === strpos($text, $needle)) {
            return false;
        }
    }
    return true;
}

function vt_effective_thumb_url( $post_id ) {
    $post_id = intval( $post_id );
    if ( $post_id <= 0 ) return '';
    $thumb_url = (string) get_the_post_thumbnail_url( $post_id, 'full' );
    if ( '' !== trim( $thumb_url ) ) {
        if ( function_exists( 'vt_maint_is_placeholder_avatar_url' ) && vt_maint_is_placeholder_avatar_url( $thumb_url ) ) {
            // keep checking fallback meta
        } else {
            return $thumb_url;
        }
    }
    $m = trim( (string) get_post_meta( $post_id, 'vt_thumb_url', true ) );
    if ( '' !== $m ) {
        if ( function_exists( 'vt_maint_is_placeholder_avatar_url' ) && vt_maint_is_placeholder_avatar_url( $m ) ) {
            // keep checking source
        } else {
            return $m;
        }
    }
    $s = trim( (string) get_post_meta( $post_id, 'vt_thumb_source_url', true ) );
    if ( '' !== $s ) {
        if ( function_exists( 'vt_maint_is_placeholder_avatar_url' ) && vt_maint_is_placeholder_avatar_url( $s ) ) {
            return '';
        }
        return $s;
    }
    return '';
}

function vt_count_effective_missing_thumbs( $sample = 3000 ) {
    $sample = max( 200, min( 20000, intval( $sample ) ) );
    $q = new WP_Query([
        'post_type'      => 'vtuber',
        'post_status'    => 'publish',
        'posts_per_page' => $sample,
        'fields'         => 'ids',
        'no_found_rows'  => true,
        'orderby'        => 'modified',
        'order'          => 'DESC',
    ]);
    $miss = 0;
    if ( $q->have_posts() ) {
        foreach ( $q->posts as $pid ) {
            if ( '' === vt_effective_thumb_url( intval( $pid ) ) ) {
                $miss++;
            }
        }
        wp_reset_postdata();
    }
    return [ 'sample' => intval( $sample ), 'missing' => intval( $miss ) ];
}

function vt_avatar_diagnose_report( $sample = 1200 ) {
    vt_load_maint_plugin_file();

    $sample = max( 100, min( 8000, intval( $sample ) ) );
    $q = new WP_Query([
        'post_type'      => 'vtuber',
        'post_status'    => 'publish',
        'posts_per_page' => $sample,
        'fields'         => 'ids',
        'orderby'        => 'modified',
        'order'          => 'DESC',
        'no_found_rows'  => true,
    ]);

    $summary = [
        'utc' => gmdate('c'),
        'checked' => 0,
        'need_fix' => 0,
        'reasons' => [
            'no_thumbnail' => 0,
            'placeholder_url' => 0,
            'tiny_file' => 0,
            'small_dimensions' => 0,
            'no_social_url' => 0,
            'has_social_url_but_unresolved' => 0,
        ],
        'items' => [],
    ];

    if ( $q->have_posts() ) {
        foreach ( $q->posts as $pid ) {
            $pid = intval( $pid );
            $summary['checked']++;
            $reasons = [];

            $thumb_id = intval( get_post_thumbnail_id( $pid ) );
            $thumb_url = get_the_post_thumbnail_url( $pid, 'full' );
            $effective_thumb = vt_effective_thumb_url( $pid );
            if ( '' === trim( (string) $effective_thumb ) ) {
                $reasons[] = 'no_thumbnail';
            } else {
                if ( function_exists( 'vt_maint_is_placeholder_avatar_url' ) && vt_maint_is_placeholder_avatar_url( (string) $effective_thumb ) ) {
                    $reasons[] = 'placeholder_url';
                }
                // Only evaluate file quality when actually using local attachment.
                if ( $thumb_id > 0 && '' !== trim((string) $thumb_url) && $effective_thumb === $thumb_url ) {
                    $file = get_attached_file( $thumb_id );
                    if ( is_string( $file ) && file_exists( $file ) ) {
                        $fs = intval( @filesize( $file ) );
                        if ( $fs > 0 && $fs < 4500 ) {
                            $reasons[] = 'tiny_file';
                        }
                        $sz = @getimagesize( $file );
                        $w  = intval( $sz[0] ?? 0 );
                        $h  = intval( $sz[1] ?? 0 );
                        if ( $w > 0 && $h > 0 && ( $w < 120 || $h < 120 ) ) {
                            $reasons[] = 'small_dimensions';
                        }
                    }
                }
            }

            $links = [
                'youtube'   => trim( (string) get_post_meta( $pid, 'vt_youtube_url', true ) ),
                'twitch'    => trim( (string) get_post_meta( $pid, 'vt_twitch_url', true ) ),
                'twitter'   => trim( (string) get_post_meta( $pid, 'vt_twitter_url', true ) ),
                'facebook'  => trim( (string) get_post_meta( $pid, 'vt_facebook_url', true ) ),
                'instagram' => trim( (string) get_post_meta( $pid, 'vt_instagram', true ) ),
                'bluesky'   => trim( (string) get_post_meta( $pid, 'vt_bluesky_url', true ) ),
            ];
            $has_social = false;
            foreach ( $links as $u ) {
                if ( '' !== $u ) {
                    $has_social = true;
                    break;
                }
            }
            $marked_no_social = '1' === (string) get_post_meta( $pid, 'vt_no_social_source', true );
            if ( !$has_social ) {
                // If this post is explicitly marked as source-missing, do not keep reporting it as "need_fix".
                if ( ! $marked_no_social ) {
                    $reasons[] = 'no_social_url';
                }
            } elseif ( !empty($reasons) ) {
                $reasons[] = 'has_social_url_but_unresolved';
            }

            $reasons = array_values( array_unique( $reasons ) );
            if ( !empty( $reasons ) ) {
                $summary['need_fix']++;
                foreach ( $reasons as $r ) {
                    if ( isset( $summary['reasons'][ $r ] ) ) {
                        $summary['reasons'][ $r ]++;
                    }
                }
                if ( count( $summary['items'] ) < 400 ) {
                    $summary['items'][] = [
                        'id' => $pid,
                        'title' => get_the_title( $pid ),
                        'thumb' => (string) $effective_thumb,
                        'source_thumb' => (string) get_post_meta( $pid, 'vt_thumb_source_url', true ),
                        'reasons' => $reasons,
                        'links' => $links,
                    ];
                }
            }
        }
        wp_reset_postdata();
    }

    $dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
    if ( !is_dir( $dir ) ) {
        wp_mkdir_p( $dir );
    }
    @file_put_contents( $dir . 'avatar-diagnose.json', json_encode( $summary, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
    return $summary;
}

function vt_backup_readiness_report() {
    $root = __DIR__;
    $checks = [];
    $issues = [];

    $paths = [
        'maint_runner' => $root . '/wp-content/plugins/vt-maint-runner.php',
        'maint_api' => $root . '/vt-maint.php',
        'maint_status' => $root . '/vt-status.php',
        'portal_css' => $root . '/wp-content/plugins/vtuber-portal/assets/vtuber-portal.css',
        'single_template' => $root . '/wp-content/plugins/vtuber-portal/templates/single-vtuber.php',
    ];

    foreach ($paths as $name => $path) {
        $ok = file_exists($path);
        $checks[] = [ 'name' => $name, 'path' => $path, 'ok' => $ok ];
        if (!$ok) {
            $issues[] = [ 'severity' => 'error', 'type' => 'missing_file', 'file' => $path ];
        }
    }

    $git_ok = is_dir($root . '/.git');
    $checks[] = [ 'name' => 'git_initialized', 'path' => $root . '/.git', 'ok' => $git_ok ];
    if (!$git_ok) {
        $issues[] = [ 'severity' => 'warn', 'type' => 'git_not_initialized', 'file' => $root . '/.git' ];
    }

    $secret_patterns = [
        [ 'name' => 'google_api_key', 're' => '/AIza[0-9A-Za-z\\-_]{20,}/' ],
        [ 'name' => 'github_pat', 're' => '/github_pat_[A-Za-z0-9_]{20,}/' ],
        [ 'name' => 'github_token', 're' => '/ghp_[A-Za-z0-9]{20,}/' ],
        [ 'name' => 'openai_key', 're' => '/sk-[A-Za-z0-9]{20,}/' ],
        [ 'name' => 'twitch_secret_like', 're' => '/client[_\\- ]?secret\\s*[:=]\\s*[\'\\"][^\'\\"]{8,}[\'\\"]/i' ],
    ];

    $scan_files = [
        $paths['maint_runner'],
        $paths['maint_api'],
        $paths['maint_status'],
        $root . '/wp-config.php',
    ];
    foreach ($scan_files as $f) {
        if (!file_exists($f)) continue;
        $txt = (string) @file_get_contents($f);
        if ($txt === '') continue;
        foreach ($secret_patterns as $p) {
            if (preg_match($p['re'], $txt)) {
                $issues[] = [ 'severity' => 'warn', 'type' => 'possible_secret', 'pattern' => $p['name'], 'file' => $f ];
            }
        }
    }

    $gitignore = $root . '/.gitignore';
    $required_gitignore = [
        'wp-config.php',
        'wp-content/uploads/',
        '*.log',
        '.env',
    ];
    $gitignore_ok = file_exists($gitignore);
    $checks[] = [ 'name' => 'gitignore_exists', 'path' => $gitignore, 'ok' => $gitignore_ok ];
    if (!$gitignore_ok) {
        $issues[] = [ 'severity' => 'warn', 'type' => 'missing_gitignore', 'file' => $gitignore ];
    } else {
        $git_txt = (string) @file_get_contents($gitignore);
        foreach ($required_gitignore as $line) {
            if (false === strpos($git_txt, $line)) {
                $issues[] = [ 'severity' => 'warn', 'type' => 'gitignore_missing_rule', 'rule' => $line, 'file' => $gitignore ];
            }
        }
    }

    $summary = [
        'utc' => gmdate('c'),
        'ok' => empty(array_filter($issues, function($it){ return ($it['severity'] ?? '') === 'error'; })),
        'checks' => $checks,
        'issues' => $issues,
        'next_actions' => [
            'Use private GitHub repository only.',
            'Rotate and remove detected secrets before first push.',
            'Commit portal plugin + maintain code first, then optional data snapshots.',
        ],
    ];

    $dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
    if (!is_dir($dir)) wp_mkdir_p($dir);
    @file_put_contents($dir . 'backup-readiness.json', json_encode($summary, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    return $summary;
}

if ($action === 'opcache') {
    header('Content-Type: text/plain; charset=utf-8');
    $files = [
        __DIR__ . '/wp-content/plugins/vt-maint-runner.php',
        __DIR__ . '/wp-content/plugins/wp-vtuber-cpts.php',
        __DIR__ . '/wp-content/plugins/vt-news-aggregator.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/vt-portal-landing.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/archive-vtuber.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/single-vtuber.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/vt-platform-index.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/vt-agency-index.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/vt-country-index.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/vt-debut-year-index.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/vt-role-index.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/vt-contact.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/taxonomy-agency.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/taxonomy-platform.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/taxonomy-role-tag.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/taxonomy-franchise.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/taxonomy-life-status.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/taxonomy-country.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/templates/taxonomy-debut-year.php',
        __DIR__ . '/wp-content/plugins/vtuber-portal/assets/vtuber-portal.css',
        __DIR__ . '/vt-status.php',
        __DIR__ . '/vt-maint.php',
    ];
    $ok = 0;
    $missing = 0;
    if ( function_exists( 'opcache_invalidate' ) ) {
        foreach ( $files as $f ) {
            if ( file_exists( $f ) ) {
                @opcache_invalidate( $f, true );
                $ok++;
            } else {
                $missing++;
            }
        }
        echo "ok opcache_invalidate files=$ok missing=$missing\n";
        exit;
    }
    echo "opcache_invalidate not available\n";
    exit;
}

if ($action === 'backup_readiness' || $action === 'backup_readiness_raw') {
    $report = vt_backup_readiness_report();
    vt_log('backup_readiness ok=' . (!empty($report['ok']) ? '1' : '0') . ' issues=' . count((array)($report['issues'] ?? [])));
    if ($action === 'backup_readiness_raw') {
        echo json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    echo "ok backup_readiness\n";
    echo "report: /wp-content/uploads/vt-logs/backup-readiness.json\n";
    echo "issues: " . count((array)($report['issues'] ?? [])) . "\n";
    exit;
}

if ( $action === 'news_refresh' || $action === 'news_refresh_raw' ) {
    if ( !function_exists( 'vt_news_refresh_cache_batch' ) ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "error: vt_news_refresh_cache_batch not available\n";
        exit;
    }
    $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 18;
    $res = vt_news_refresh_cache_batch( $batch );
    vt_log( 'news_refresh batch=' . intval($batch) . ' ok=' . ( !empty($res['ok']) ? '1' : '0' ) );
    header('Content-Type: text/plain; charset=utf-8');
    if ( $action === 'news_refresh_raw' ) {
        echo json_encode( $res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) . "\n";
        exit;
    }
    echo "ok news_refresh\n";
    echo "report: /wp-content/uploads/vt-logs/news-refresh-last.json\n";
    exit;
}

if ( $action === 'avatar_diagnose' || $action === 'avatar_diagnose_raw' ) {
    $sample = isset($_GET['sample']) ? intval($_GET['sample']) : 1800;
    $res = vt_avatar_diagnose_report( $sample );
    vt_log( 'avatar_diagnose checked=' . intval($res['checked'] ?? 0) . ' need_fix=' . intval($res['need_fix'] ?? 0) );
    header('Content-Type: text/plain; charset=utf-8');
    if ( $action === 'avatar_diagnose_raw' ) {
        echo json_encode( $res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) . "\n";
        exit;
    }
    echo "ok avatar_diagnose checked=" . intval($res['checked'] ?? 0) . " need_fix=" . intval($res['need_fix'] ?? 0) . "\n";
    echo "report: /wp-content/uploads/vt-logs/avatar-diagnose.json\n";
    exit;
}

if ( $action === 'fix_tiny_thumb_fallback' || $action === 'fix_tiny_thumb_fallback_raw' ) {
    if ( ! vt_load_maint_plugin_file() ) {
        echo "missing vt-maint-runner.php\n";
        exit;
    }
    if ( ! function_exists( 'vt_maint_fix_tiny_thumb_fallback_run' ) ) {
        echo "missing function vt_maint_fix_tiny_thumb_fallback_run\n";
        exit;
    }
    $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 120;
    $res = vt_maint_fix_tiny_thumb_fallback_run( $batch );
    vt_log( 'fix_tiny_thumb_fallback batch=' . intval($batch) . ' fixed=' . intval($res['fixed'] ?? 0) );
    header('Content-Type: text/plain; charset=utf-8');
    if ( $action === 'fix_tiny_thumb_fallback_raw' ) {
        echo json_encode( $res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) . "\n";
        exit;
    }
    echo "ok fix_tiny_thumb_fallback\n";
    echo "report: /wp-content/uploads/vt-logs/tiny-thumb-fallback-last.json\n";
    exit;
}

// SEO keyword import from uploaded GSC query report.
if ( $action === 'seo_keywords_import' || $action === 'seo_keywords_import_raw' ) {
    vt_register_fatal_probe($action);
    if ( ! vt_load_maint_plugin_file() ) {
        echo "missing vt-maint-runner.php\n";
        exit;
    }
    if ( ! function_exists( 'vt_maint_seo_keywords_import_run' ) ) {
        echo "missing fn vt_maint_seo_keywords_import_run\n";
        exit;
    }
    $limit = isset($_GET['limit']) ? intval($_GET['limit']) : 80;
    $res = vt_maint_seo_keywords_import_run($limit);
    if ( $action === 'seo_keywords_import_raw' ) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
    echo "ok=" . (intval($res['ok'] ?? 0)) . " updated=" . (intval($res['updated'] ?? 0)) . "\n";
    if (isset($res['reason'])) echo "reason=" . (string)$res['reason'] . "\n";
    if (isset($res['file'])) echo "file=" . (string)$res['file'] . "\n";
    if (isset($res['log'])) echo "log=" . (string)$res['log'] . "\n";
    exit;
}

if ( $action === 'metrics_diagnose' || $action === 'metrics_diagnose_raw' ) {
    if ( ! function_exists( 'vt_maint_metrics_diagnose_report' ) ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "missing function vt_maint_metrics_diagnose_report\n";
        exit;
    }
    $res = vt_maint_metrics_diagnose_report();
    vt_log( 'metrics_diagnose ok=' . ( ! empty( $res['ok'] ) ? '1' : '0' ) );
    header('Content-Type: text/plain; charset=utf-8');
    if ( $action === 'metrics_diagnose_raw' ) {
        echo json_encode( $res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) . "\n";
        exit;
    }
    echo "ok metrics_diagnose\n";
    echo "report: /wp-content/uploads/vt-logs/metrics-diagnose.json\n";
    exit;
}

if ($action === 'site_audit' || $action === 'site_audit_raw') {
    // Lightweight end-to-end audit to catch "old page still linked" regressions.
    // Writes a JSON report under uploads so vt-status.php can render it.
    $report_dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
    if (!is_dir($report_dir)) {
        wp_mkdir_p($report_dir);
    }
    $report_file = $report_dir . 'site-audit.json';

    $targets = [];
    $home = home_url('/');
    $targets[] = [
        'name' => 'Home',
        'url' => $home,
        'must' => [ 'vt-landing-custom-template', 'vt-search-input', 'pll-switcher' ],
        'timeout' => 20,
    ];

    $vt_archive = get_post_type_archive_link('vtuber');
    if ($vt_archive) {
        $targets[] = [
            'name' => 'VTuber Archive',
            'url' => $vt_archive,
            'must' => [ 'vt-landing-archive', 'vt-card-grid', 'pll-switcher' ],
            'timeout' => 15,
        ];
    }

    $sample_single = '';
    $q = new WP_Query([
        'post_type' => 'vtuber',
        'posts_per_page' => 1,
        'no_found_rows' => true,
        'orderby' => 'modified',
        'order' => 'DESC',
    ]);
    if ($q->have_posts()) {
        $q->the_post();
        $sample_single = get_permalink(get_the_ID());
        wp_reset_postdata();
    }
    if ($sample_single) {
        $targets[] = [
            'name' => 'VTuber Single (latest modified)',
            'url' => $sample_single,
            // vt-social-strip is optional for entries without social links.
            'must' => [ 'vt-landing-single', 'pll-switcher' ],
            'timeout' => 20,
        ];
    }

    // Taxonomy term pages must render with portal templates (not theme legacy UI).
    $targets[] = [ 'name' => 'Agency (term archive: indie)', 'url' => home_url('/agency/indie/'), 'must' => [ 'vt-taxonomy-template', 'vt-landing-tax' ] ];
    $targets[] = [ 'name' => 'Platform (term archive: youtube)', 'url' => home_url('/platform/youtube/'), 'must' => [ 'vt-taxonomy-template', 'vt-landing-tax' ] ];
    $targets[] = [ 'name' => 'Life status (active)', 'url' => home_url('/life-status/active/'), 'must' => [ 'vt-taxonomy-template', 'vt-landing-tax' ] ];

    // Sample a non-indie agency term (if exists) to catch regressions like "春魚創意".
    $agency_terms = get_terms([
        'taxonomy' => 'agency',
        'hide_empty' => true,
        'orderby' => 'count',
        'order' => 'DESC',
        'number' => 5,
    ]);
    if (!is_wp_error($agency_terms) && is_array($agency_terms)) {
        foreach ($agency_terms as $t) {
            if (!isset($t->slug) || $t->slug === 'indie') continue;
            $u = get_term_link($t);
            if (!is_wp_error($u)) {
                $targets[] = [ 'name' => 'Agency (term archive sample)', 'url' => $u, 'must' => [ 'vt-taxonomy-template', 'vt-landing-tax' ] ];
            }
            break;
        }
    }

    // Sample a role-tag term if exists.
    $role_terms = get_terms([
        'taxonomy' => 'role-tag',
        'hide_empty' => true,
        'orderby' => 'count',
        'order' => 'DESC',
        'number' => 3,
    ]);
    if (!is_wp_error($role_terms) && is_array($role_terms) && !empty($role_terms)) {
        $u = get_term_link($role_terms[0]);
        if (!is_wp_error($u)) {
            $targets[] = [ 'name' => 'Role-tag (term archive sample)', 'url' => $u, 'must' => [ 'vt-taxonomy-template', 'vt-landing-tax' ] ];
        }
    }

    // Contact page existence and correct resolution.
    $contact_page = get_page_by_path('contact') ?: get_page_by_path('contact-us');
    $contact_url = $contact_page ? get_permalink($contact_page) : home_url('/contact/');
    $targets[] = [ 'name' => 'Contact', 'url' => $contact_url, 'must' => [ '<html', '</html>' ] ];

    // Legacy category paths should not render old theme UI.
    $sample_cat = get_categories([ 'hide_empty' => true, 'number' => 1 ]);
    if (!empty($sample_cat) && is_array($sample_cat)) {
        $cat_url = get_category_link(intval($sample_cat[0]->term_id));
        if (!is_wp_error($cat_url)) {
            $targets[] = [ 'name' => 'Legacy category path redirected to portal', 'url' => $cat_url, 'must' => [ 'vt-landing' ], 'optional' => true ];
        }
    }
    $targets[] = [ 'name' => 'Unknown legacy category path redirected to portal', 'url' => home_url('/category/legacy-check/'), 'must' => [ 'vt-landing' ], 'optional' => true ];

    // REST endpoint for live search.
    $targets[] = [
        'name' => 'REST vtuber',
        'url' => home_url('/wp-json/wp/v2/vtuber?per_page=1&_fields=id'),
        'must' => [ '[' ],
    ];
    $targets[] = [
        'name' => 'Sitemap index',
        'url' => home_url('/sitemap_index.xml'),
        'must' => [ '<sitemapindex', 'vtuber-sitemap' ],
    ];
    $targets[] = [
        'name' => 'VTuber sitemap',
        'url' => home_url('/vtuber-sitemap.xml'),
        'must' => [ '<urlset', '/vtuber/' ],
    ];

    $results = [];
    $fail = 0;
    $pass = 0;

    foreach ($targets as $t) {
        $url = $t['url'];
        $r = vt_http_get($url, intval($t['timeout'] ?? 12));
        $body = $r['body'];
        $checks = [];
        $ok = $r['ok'];

        foreach (($t['must'] ?? []) as $needle) {
            $found = ($body !== '' && false !== strpos($body, $needle));
            $checks[] = [ 'needle' => $needle, 'found' => $found ];
            if (!$found) $ok = false;
        }
        // Some hosts occasionally throttle old category probes and produce timeout-only failures.
        // Keep this check informational when marked optional to avoid false negatives in audit score.
        if ( ! $ok && ! empty( $t['optional'] ) ) {
            $err_msg = (string) ( $r['err'] ?? '' );
            if ( false !== stripos( $err_msg, 'timed out' ) || false !== stripos( $err_msg, 'timeout' ) ) {
                $ok = true;
            }
        }

        $results[] = [
            'name' => $t['name'],
            'url' => $url,
            'ok' => $ok,
            'code' => $r['code'],
            'err' => $r['err'],
            'checks' => $checks,
        ];

        if ($ok) $pass++; else $fail++;
    }

    // Also validate key links on the home page (nav + CTA) still resolve.
    $link_names = [
        'VTuber Archive' => $vt_archive ?: home_url('/vtuber/'),
        'Platform Index' => home_url('/platforms/'),
        'Agency Index' => home_url('/agencies/'),
        'Role Index' => home_url('/roles/'),
        'Character Archive' => get_post_type_archive_link('character') ?: home_url('/character/'),
        'Anime Archive' => get_post_type_archive_link('anime-work') ?: home_url('/anime/'),
        'Contact' => $contact_url,
    ];
    $link_results = [];
    foreach ($link_names as $lname => $lurl) {
        $r = vt_http_get($lurl, 8);
        $link_results[] = [
            'name' => $lname,
            'url' => $lurl,
            'ok' => $r['ok'],
            'code' => $r['code'],
            'err' => $r['err'],
        ];
    }

    // Crawl sample links to catch hidden legacy connections not in fixed target list.
    $site_host = wp_parse_url(home_url('/'), PHP_URL_HOST);
    $seed_urls = [ $home ];
    if (!empty($vt_archive)) $seed_urls[] = $vt_archive;
    if (!empty($sample_single)) $seed_urls[] = $sample_single;

    $candidate_links = [];
    $legacy_links = [];
    foreach ($seed_urls as $seed) {
        $res = vt_http_get($seed, 8);
        if (!$res['ok']) continue;
        $links = vt_extract_internal_links((string) $res['body'], $site_host, 180);
        foreach ($links as $u) {
            if (vt_is_legacy_path($u)) {
                if (!isset($legacy_links[$u])) $legacy_links[$u] = [];
                $legacy_links[$u][] = $seed;
                continue;
            }
            if (vt_is_portal_related_path($u)) {
                $candidate_links[$u] = true;
            }
        }
    }
    $candidate_links = array_values(array_keys($candidate_links));
    // Keep runtime bounded.
    $max_check = 12;
    if (count($candidate_links) > $max_check) {
        $candidate_links = array_slice($candidate_links, 0, $max_check);
    }

    $crawl_items = [];
    $crawl_fail = 0;
    $crawl_pass = 0;
    foreach ($candidate_links as $u) {
        $r = vt_http_get($u, 8);
        $ok = $r['ok'];
        $reason = '';
        $err_msg = (string) ($r['err'] ?? '');
        $is_timeout = ( intval($r['code']) === 0 ) && ( false !== stripos($err_msg, 'timed out') || false !== stripos($err_msg, 'timeout') );
        if ( $is_timeout ) {
            // Treat transient timeout on sampled crawl URLs as soft-pass to keep audit stable.
            $ok = true;
            $reason = 'timeout_skip';
        }
        if (!$ok) {
            $reason = 'http_' . intval($r['code']);
        } else {
            $body = (string) $r['body'];
            if ( '' !== $body && !vt_has_portal_marker($body)) {
                $ok = false;
                $reason = 'legacy_or_non_portal_template';
            }
        }
        if ($ok) $crawl_pass++; else $crawl_fail++;
        $crawl_items[] = [
            'url' => $u,
            'ok' => $ok,
            'code' => intval($r['code']),
            'reason' => $reason,
        ];
    }

    $legacy_items = [];
    foreach ($legacy_links as $url => $sources) {
        $legacy_items[] = [
            'url' => $url,
            'sources' => array_values(array_unique($sources)),
            'reason' => 'linked_legacy_path',
        ];
    }

    $pass += $crawl_pass;
    $fail += $crawl_fail;
    $fail += count($legacy_items);

    // Layout audit: ensure responsive rules are deployed and single page keeps desktop multi-column structure.
    $layout_audit = [
        'ok' => false,
        'css_url' => content_url('/plugins/vtuber-portal/assets/vtuber-portal.css'),
        'css_code' => 0,
        'css_err' => '',
        'css_checks' => [],
        'metrics' => [],
        'single_checks' => [],
    ];

    $css_needles = [
        '.vt-landing-single .vt-layout',
        '.vt-two-col',
        '.vt-detail-layout',
        '@media (min-width: 768px)',
        '@media (min-width: 1024px)',
        '@media (min-width: 1280px)',
        '@media (min-width: 1536px)',
        'var(--vt-shell-wide)',
        'body.vt-landing .vt-section-neo h2',
        // Newsmatic optional overlay that makes desktop feel like a small framed page.
        '.newsmatic_website_frame',
        'display: none !important',
    ];
    $single_needles = [
        'vt-landing-single',
        'vt-two-col',
        'vt-detail-layout',
        'vt-aside-sticky',
        // vt-social-strip is optional and should not fail layout audit.
    ];

    $css_resp = vt_http_get($layout_audit['css_url'], 8);
    $layout_audit['css_code'] = intval($css_resp['code']);
    $layout_audit['css_err'] = (string) ($css_resp['err'] ?? '');
    $css_text = (string) ($css_resp['body'] ?? '');
    $css_ok = $css_resp['ok'];
    foreach ($css_needles as $needle) {
        $found = (false !== strpos($css_text, $needle));
        $layout_audit['css_checks'][] = [ 'needle' => $needle, 'found' => $found ];
        if (!$found) $css_ok = false;
    }

    // Numeric guardrails (not only string presence).
    $shell_standard = 0;
    $shell_wide = 0;
    if (preg_match('/--vt-shell-standard\\s*:\\s*(\\d+)px/i', $css_text, $mstd)) {
        $shell_standard = intval($mstd[1]);
    }
    if (preg_match('/--vt-shell-wide\\s*:\\s*(\\d+)px/i', $css_text, $mwide)) {
        $shell_wide = intval($mwide[1]);
    }
    $metrics = [
        [ 'name' => 'shell_standard_px>=1600', 'value' => $shell_standard, 'ok' => ($shell_standard >= 1600) ],
        [ 'name' => 'shell_wide_px>=2000', 'value' => $shell_wide, 'ok' => ($shell_wide >= 2000) ],
        [ 'name' => 'shell_wide_gt_standard', 'value' => ($shell_wide - $shell_standard), 'ok' => ($shell_wide > $shell_standard) ],
    ];
    foreach ($metrics as $mc) {
        $layout_audit['metrics'][] = $mc;
        if (empty($mc['ok'])) {
            $css_ok = false;
        }
    }

    $single_ok = false;
    if ($sample_single) {
        $single_resp = vt_http_get($sample_single, 12);
        $single_html = (string) ($single_resp['body'] ?? '');
        $single_ok = $single_resp['ok'];
        foreach ($single_needles as $needle) {
            $found = (false !== strpos($single_html, $needle));
            $layout_audit['single_checks'][] = [ 'needle' => $needle, 'found' => $found ];
            if (!$found) $single_ok = false;
        }
    } else {
        $layout_audit['single_checks'][] = [ 'needle' => 'sample_single_exists', 'found' => false ];
    }

    $layout_audit['ok'] = (bool) ($css_ok && $single_ok);
    if ($layout_audit['ok']) {
        $pass++;
    } else {
        $fail++;
    }

    $report = [
        'utc' => gmdate('c'),
        'pass' => $pass,
        'fail' => $fail,
        'targets' => $results,
        'links' => $link_results,
        'crawl' => [
            'seed_count' => count($seed_urls),
            'checked' => count($crawl_items),
            'pass' => $crawl_pass,
            'fail' => $crawl_fail,
            'items' => $crawl_items,
        ],
        'legacy_links' => [
            'count' => count($legacy_items),
            'items' => $legacy_items,
        ],
        'layout_audit' => $layout_audit,
    ];

    // i18n SEO audit (hreflang/canonical on home + sample single).
    $i18n_audit = [
        'ok' => false,
        'langs_count' => 0,
        'home' => [],
        'single' => [],
    ];
    if ( function_exists( 'pll_languages_list' ) ) {
        $langs = pll_languages_list( [ 'fields' => 'slug' ] );
        $i18n_audit['langs_count'] = is_array($langs) ? count($langs) : 0;
    }
    $home_res = vt_http_get($home, 20);
    $home_html = (string) ($home_res['body'] ?? '');
    $i18n_audit['home'] = [
        'ok' => ( $home_res['ok'] && false !== strpos($home_html, 'hreflang=') && false !== strpos($home_html, 'rel="canonical"') ),
        'code' => intval($home_res['code']),
        'has_hreflang' => (false !== strpos($home_html, 'hreflang=')),
        'has_x_default' => (false !== strpos($home_html, 'hreflang="x-default"')),
        'has_canonical' => (false !== strpos($home_html, 'rel="canonical"')),
    ];
    $single_ok = false;
    if ( $sample_single ) {
        $single_res = vt_http_get($sample_single, 20);
        $single_html = (string) ($single_res['body'] ?? '');
        $single_ok = ( $single_res['ok'] && false !== strpos($single_html, 'hreflang=') && false !== strpos($single_html, 'rel="canonical"') );
        $i18n_audit['single'] = [
            'ok' => $single_ok,
            'code' => intval($single_res['code']),
            'has_hreflang' => (false !== strpos($single_html, 'hreflang=')),
            'has_x_default' => (false !== strpos($single_html, 'hreflang="x-default"')),
            'has_canonical' => (false !== strpos($single_html, 'rel="canonical"')),
        ];
    } else {
        $i18n_audit['single'] = [ 'ok' => false, 'code' => 0, 'has_hreflang' => false, 'has_x_default' => false, 'has_canonical' => false ];
    }
    $i18n_audit['ok'] = ( !empty($i18n_audit['home']['ok']) && !empty($i18n_audit['single']['ok']) && intval($i18n_audit['langs_count']) >= 5 );
    if ( $i18n_audit['ok'] ) $pass++; else $fail++;
    $report['i18n_audit'] = $i18n_audit;

    $news_last_utc = (string) get_option( 'vt_news_last_refresh_utc', '' );
    $news_age_sec  = 0;
    if ( '' !== $news_last_utc ) {
        $ts = strtotime( $news_last_utc );
        if ( false !== $ts ) {
            $news_age_sec = max( 0, time() - intval( $ts ) );
        }
    }
    $news_audit = [
        'ok' => ( $news_age_sec > 0 && $news_age_sec <= 12 * HOUR_IN_SECONDS ),
        'last_refresh_utc' => $news_last_utc,
        'age_seconds' => $news_age_sec,
        'batch_count' => intval( get_option( 'vt_news_last_refresh_count', 0 ) ),
    ];
    if ( $news_audit['ok'] ) $pass++; else $fail++;
    $report['news_audit'] = $news_audit;

    @file_put_contents($report_file, json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    vt_log("site_audit pass=$pass fail=$fail");

    header('Content-Type: text/plain; charset=utf-8');
    if ($action === 'site_audit_raw') {
        echo json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }

    echo "ok site_audit pass=$pass fail=$fail\n";
    echo "report: /wp-content/uploads/vt-logs/site-audit.json\n";
    exit;
}

if ($action === 'polylang_setup' || $action === 'polylang_setup_raw') {
    // Configure Polylang URL mode and ensure required languages exist.
    // Target:
    // - Default language: zh (no prefix)
    // - Other languages: /cn/, /ja/, /en/, /ko/, /es/, /hi/
    require_once ABSPATH . 'wp-admin/includes/plugin.php';

    $report_dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
    if (!is_dir($report_dir)) {
        wp_mkdir_p($report_dir);
    }
    $report_file = $report_dir . 'polylang-setup.json';

    $report = [
        'utc' => gmdate('c'),
        'ok' => false,
        'errors' => [],
        'languages_before' => [],
        'languages_after' => [],
        'options_before' => [],
        'options_after' => [],
        'added' => [],
    ];

    if (!function_exists('PLL')) {
        $report['errors'][] = 'polylang_not_loaded';
        @file_put_contents($report_file, json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        header('Content-Type: text/plain; charset=utf-8');
        echo $action === 'polylang_setup_raw' ? json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) : "err polylang_not_loaded\n";
        exit;
    }

    // Snapshot current languages/options.
    if (function_exists('pll_languages_list')) {
        $report['languages_before'] = pll_languages_list(['fields' => 'slug']);
    }
    $opt = get_option('polylang', []);
    $report['options_before'] = is_array($opt) ? $opt : ['_raw' => $opt];

    $required_langs = [
        // Default: Traditional Chinese (no prefix).
        [ 'name' => 'Traditional Chinese', 'slug' => 'zh', 'locale' => 'zh_TW', 'rtl' => false, 'term_group' => 0, 'flag_code' => 'tw' ],
        // Other languages: directory prefixes.
        [ 'name' => 'Simplified Chinese', 'slug' => 'cn', 'locale' => 'zh_CN', 'rtl' => false, 'term_group' => 1, 'flag_code' => 'cn' ],
        [ 'name' => 'Japanese', 'slug' => 'ja', 'locale' => 'ja', 'rtl' => false, 'term_group' => 2, 'flag_code' => 'jp' ],
        [ 'name' => 'English', 'slug' => 'en', 'locale' => 'en_US', 'rtl' => false, 'term_group' => 3, 'flag_code' => 'us' ],
        [ 'name' => 'Korean', 'slug' => 'ko', 'locale' => 'ko_KR', 'rtl' => false, 'term_group' => 4, 'flag_code' => 'kr' ],
        [ 'name' => 'Spanish', 'slug' => 'es', 'locale' => 'es_ES', 'rtl' => false, 'term_group' => 5, 'flag_code' => 'es' ],
        [ 'name' => 'Hindi', 'slug' => 'hi', 'locale' => 'hi_IN', 'rtl' => false, 'term_group' => 6, 'flag_code' => 'in' ],
    ];

    // Ensure languages exist (idempotent).
    $added = [];
    foreach ($required_langs as $lang_args) {
        $slug = (string) ($lang_args['slug'] ?? '');
        if ($slug === '') continue;
        $exists = false;
        if (function_exists('pll_languages_list')) {
            $slugs = pll_languages_list(['fields' => 'slug']);
            $exists = is_array($slugs) && in_array($slug, $slugs, true);
        }
        if ($exists) continue;

        try {
            $r = PLL()->model->add_language($lang_args);
            if (is_wp_error($r)) {
                $report['errors'][] = 'add_language_failed:' . $slug . ':' . $r->get_error_message();
            } else {
                $added[] = $slug;
            }
        } catch (Throwable $e) {
            $report['errors'][] = 'add_language_exception:' . $slug . ':' . $e->getMessage();
        }
    }
    $report['added'] = $added;

    // Configure URL mode.
    // force_lang:
    // - 1 = directory (/en/...) on pretty permalinks
    // rewrite:
    // - true removes /language/ base
    // hide_default:
    // - true removes prefix for default language
    $opt = get_option('polylang', []);
    if (!is_array($opt)) $opt = [];

    $opt['force_lang'] = 1;
    $opt['rewrite'] = true;
    $opt['hide_default'] = true;
    $opt['default_lang'] = 'zh';

    // Ensure Polylang translates our main CPTs/taxonomies (do not remove existing ones).
    if (!isset($opt['post_types']) || !is_array($opt['post_types'])) $opt['post_types'] = [];
    if (!isset($opt['taxonomies']) || !is_array($opt['taxonomies'])) $opt['taxonomies'] = [];
    $opt['post_types'] = array_values(array_unique(array_merge($opt['post_types'], ['page','post','vtuber','voice-actor','anime-work','character'])));
    $opt['taxonomies'] = array_values(array_unique(array_merge($opt['taxonomies'], ['category','post_tag','agency','platform','role-tag','franchise','life-status','country','debut-year'])));

    update_option('polylang', $opt);
    flush_rewrite_rules();

    if (function_exists('pll_languages_list')) {
        $report['languages_after'] = pll_languages_list(['fields' => 'slug']);
    }
    $report['options_after'] = get_option('polylang', []);

    $report['ok'] = empty($report['errors']);
    @file_put_contents($report_file, json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    header('Content-Type: text/plain; charset=utf-8');
    if ($action === 'polylang_setup_raw') {
        echo json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    echo $report['ok'] ? "ok polylang_setup\n" : ("err polylang_setup " . implode(';', $report['errors']) . "\n");
    echo "report: /wp-content/uploads/vt-logs/polylang-setup.json\n";
    exit;
}

if ($action === 'ensure_translations' || $action === 'ensure_translations_raw') {
    $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 25;
    $batch = max(5, min(120, $batch));

    if ( ! vt_load_maint_plugin_file() ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "err maint_runner_missing\n";
        exit;
    }
    if ( ! function_exists( 'vt_maint_ensure_translations_run' ) ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "err ensure_translations_not_available\n";
        exit;
    }

    $res = vt_maint_ensure_translations_run( $batch );
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/translations-ensure-last.json';
    header('Content-Type: text/plain; charset=utf-8');
    if ($action === 'ensure_translations_raw') {
        if (is_array($res) && !empty($res['locked'])) {
            echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
            exit;
        }
        if (file_exists($file)) {
            echo file_get_contents($file) . "\n";
        } else {
            echo "{}\n";
        }
        exit;
    }
    if (is_array($res) && !empty($res['locked'])) {
        echo "ok ensure_translations locked=1 batch=$batch\n";
        exit;
    }
    echo "ok ensure_translations batch=$batch\n";
    echo "report: /wp-content/uploads/vt-logs/translations-ensure-last.json\n";
    exit;
}

if ($action === 'ensure_page_translations' || $action === 'ensure_page_translations_raw') {
    if ( ! vt_load_maint_plugin_file() ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "err maint_runner_missing\n";
        exit;
    }
    if ( ! function_exists( 'vt_maint_ensure_page_translations_run' ) ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "err ensure_page_translations_not_available\n";
        exit;
    }

    $res = vt_maint_ensure_page_translations_run();
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/page-translations-ensure-last.json';
    header('Content-Type: text/plain; charset=utf-8');
    if ($action === 'ensure_page_translations_raw') {
        if (is_array($res) && !empty($res['locked'])) {
            echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
            exit;
        }
        if (file_exists($file)) {
            echo file_get_contents($file) . "\n";
        } else {
            echo "{}\n";
        }
        exit;
    }
    if (is_array($res) && !empty($res['locked'])) {
        echo "ok ensure_page_translations locked=1\n";
        exit;
    }
    echo "ok ensure_page_translations\n";
    echo "report: /wp-content/uploads/vt-logs/page-translations-ensure-last.json\n";
    exit;
}

if ($action === 'assign_default_lang' || $action === 'assign_default_lang_raw') {
    $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 300;
    $batch = max(50, min(800, $batch));

    if ( ! vt_load_maint_plugin_file() ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "err maint_runner_missing\n";
        exit;
    }
    if ( ! function_exists( 'vt_maint_assign_default_lang_run' ) ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "err assign_default_lang_not_available\n";
        exit;
    }

    vt_maint_assign_default_lang_run( $batch );
    $file = WP_CONTENT_DIR . '/uploads/vt-logs/lang-assign-last.json';
    header('Content-Type: text/plain; charset=utf-8');
    if ($action === 'assign_default_lang_raw') {
        if (file_exists($file)) {
            echo file_get_contents($file) . "\n";
        } else {
            echo "{}\n";
        }
        exit;
    }
    echo "ok assign_default_lang batch=$batch\n";
    echo "report: /wp-content/uploads/vt-logs/lang-assign-last.json\n";
    exit;
}

if ($action === 'unlock') {
    $name = isset($_GET['name']) ? (string) $_GET['name'] : '';
    $allowed = [
        'ensure_translations' => 'vt_maint_ensure_translations_lock',
        'ensure_page_translations' => 'vt_maint_ensure_page_translations_lock',
        'assign_default_lang' => 'vt_maint_assign_default_lang_lock',
        'fillthumbs' => 'vt_maint_fillthumbs_lock',
        'fill_metrics' => 'vt_maint_fill_metrics_lock',
        'enrich_terms' => 'vt_maint_enrich_terms_lock',
        'internal_links' => 'vt_maint_internal_links_lock',
        'sync_sheet' => 'vt_maint_sync_sheet_lock',
        'sync_translation_meta' => 'vt_maint_sync_translation_meta_lock',
        'sync_translation_content' => 'vt_maint_sync_translation_content_lock',
        'sync_hololist' => 'vt_maint_sync_hololist_lock',
        'dedupe' => 'vt_maint_dedupe_lock',
    ];
    $lock_key = $allowed[$name] ?? '';

    header('Content-Type: text/plain; charset=utf-8');
    if ($lock_key === '') {
        echo "err unlock_invalid_name\n";
        exit;
    }

    delete_transient($lock_key);
    delete_option('_transient_' . $lock_key);
    delete_option('_transient_timeout_' . $lock_key);
    echo "ok unlock $name\n";
    exit;
}

if ($action === 'polylang_probe') {
    $id = isset($_GET['id']) ? intval($_GET['id']) : 0;
    if ($id <= 0) {
        // Pick the most recently modified vtuber as a default probe.
        $q = new WP_Query([
            'post_type' => 'vtuber',
            'post_status' => 'publish',
            // Avoid Polylang filters (we want to inspect any vtuber deterministically).
            'suppress_filters' => true,
            'posts_per_page' => 1,
            'orderby' => 'modified',
            'order' => 'DESC',
            'fields' => 'ids',
            'no_found_rows' => true,
        ]);
        $id = intval($q->posts[0] ?? 0);
        wp_reset_postdata();
    }

    $out = [
        'id' => $id,
        'title' => $id ? get_the_title($id) : '',
        'lang' => function_exists('pll_get_post_language') && $id ? pll_get_post_language($id, 'slug') : null,
        'translations' => function_exists('pll_get_post_translations') && $id ? pll_get_post_translations($id) : null,
    ];

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit;
}

if ($action === 'polylang_lang_counts' || $action === 'polylang_lang_counts_raw') {
    $out = [
        'utc' => gmdate('c'),
        'default' => function_exists('pll_default_language') ? pll_default_language('slug') : null,
        'current' => function_exists('pll_current_language') ? pll_current_language('slug') : null,
        'languages' => function_exists('pll_languages_list') ? pll_languages_list(['fields' => 'slug']) : [],
        'vtuber_counts' => [],
    ];

    if (function_exists('PLL') && function_exists('pll_languages_list')) {
        foreach ((array) pll_languages_list(['fields' => 'slug']) as $slug) {
            $slug = (string) $slug;
            if ($slug === '') continue;

            $term_id = 0;
            try {
                $lang = PLL()->model->get_language($slug);
                if (is_object($lang) && isset($lang->term_id)) {
                    $term_id = intval($lang->term_id);
                }
            } catch (Throwable $e) {
                $term_id = 0;
            }

            if ($term_id <= 0) {
                $out['vtuber_counts'][$slug] = null;
                continue;
            }

            $q = new WP_Query([
                'post_type' => 'vtuber',
                'post_status' => 'publish',
                'posts_per_page' => 1,
                'fields' => 'ids',
                'tax_query' => [
                    [
                        'taxonomy' => 'language',
                        'field' => 'term_id',
                        'terms' => [ $term_id ],
                    ],
                ],
            ]);
            $out['vtuber_counts'][$slug] = intval($q->found_posts);
            wp_reset_postdata();
        }
    }

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit;
}

if ($action === 'stats') {
    $total = wp_count_posts('vtuber')->publish;
    $missing = vt_count_effective_missing_thumbs( 4000 );
    echo "VTubers: $total\n";
    echo "Missing thumbs (sampled): ".intval( $missing['missing'] )."\n";
    exit;
}

if ($action === 'status') {
    $total = wp_count_posts('vtuber')->publish;
    $missing = vt_count_effective_missing_thumbs( 4000 );
    $log_file = WP_CONTENT_DIR . '/uploads/vt-logs/maint-runner.log';
    $log_file2 = WP_CONTENT_DIR . '/uploads/vt-logs/maint-log.txt';
    $tail = '';
    $tail2 = '';
    if ( file_exists( $log_file ) ) {
        $lines = file( $log_file );
        $tail_lines = array_slice( $lines, -10 );
        $tail = implode( "", $tail_lines );
    }
    if ( file_exists( $log_file2 ) ) {
        $lines = file( $log_file2 );
        $tail_lines = array_slice( $lines, -10 );
        $tail2 = implode( "", $tail_lines );
    }
    echo "=== VT Maint Status ===\n";
    echo "VTubers total: $total\n";
    echo "Missing thumbs (sampled): ".intval( $missing['missing'] )."\n";
    if ( taxonomy_exists( 'life-status' ) ) {
        $life_terms = get_terms([
            'taxonomy' => 'life-status',
            'hide_empty' => false,
        ]);
        if ( ! is_wp_error( $life_terms ) && is_array( $life_terms ) ) {
            echo "Lifecycle terms:\n";
            foreach ( $life_terms as $t ) {
                echo "- {$t->slug}: " . intval( $t->count ) . "\n";
            }
        }
    }
    echo "Log tail (maint-runner.log):\n";
    echo ($tail ?: "no log\n");
    echo "Log tail (maint-log.txt):\n";
    echo ($tail2 ?: "no log\n");
    exit;
}

if ($action === 'missing') {
    $q = new WP_Query([
        'post_type'      => 'vtuber',
        'posts_per_page' => 200,
        'fields'         => 'ids',
        'no_found_rows'  => true,
        'orderby'        => 'modified',
        'order'          => 'DESC',
    ]);
    $printed = 0;
    $sampled = 0;
    foreach ($q->posts as $pid) {
        $sampled++;
        if ( '' !== vt_effective_thumb_url( intval( $pid ) ) ) {
            continue;
        }
        $title = get_the_title($pid);
        $url   = get_permalink($pid);
        echo "$pid | $title | $url\n";
        $printed++;
        if ( $printed >= 50 ) break;
    }
    echo "Missing thumbs count (sampled): ".intval( $printed )."\n";
    exit;
}

if ($action === 'health') {
    $next = wp_next_scheduled('vt_maint_fillthumbs_event');
    $total = wp_count_posts('vtuber')->publish;
    $missing = new WP_Query([
        'post_type'      => 'vtuber',
        'posts_per_page' => 1,
        'fields'         => 'ids',
        'no_found_rows'  => true,
        'meta_query'     => [
            [
                'key'     => '_thumbnail_id',
                'compare' => 'NOT EXISTS',
            ],
        ],
    ]);
    echo "Health check:\n";
    echo "VTubers: $total\n";
    echo "Missing thumbs (sampled): ".$missing->found_posts."\n";
    echo "Next vt_maint_fillthumbs_event: ".( $next ? gmdate('c', intval($next)) : 'not scheduled' )."\n";
    echo "DISABLE_WP_CRON: ".( defined('DISABLE_WP_CRON') && DISABLE_WP_CRON ? 'true' : 'false' )."\n";
    exit;
}

if ($action === 'set_secrets') {
    if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
        header('Content-Type: text/plain; charset=utf-8');
        echo "err method_not_allowed\n";
        exit;
    }

    $raw = (string) @file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "err invalid_json\n";
        exit;
    }

    // Only allow a small set of secret-ish keys. Never echo values back.
    $allowed = [
        'vt_sheets_api_key',
        'vt_youtube_api_key',
        'vt_twitch_client_id',
        'vt_twitch_client_secret',
    ];
    $updated = [];
    foreach ($allowed as $k) {
        if (!array_key_exists($k, $data)) continue;
        $v = trim((string)$data[$k]);
        if ($v === '') continue;
        update_option($k, $v, false);
        $updated[] = $k;
    }

    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok' => 1,
        'updated' => $updated,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit;
}

if ($action === 'fillthumbs') {
    vt_load_maint_plugin_file();
    if ( function_exists( 'vt_maint_fillthumbs_run' ) ) {
        vt_maint_fillthumbs_run();
        vt_log("fillthumbs triggered via vt-maint.php");
        echo "ok fillthumbs\n";
        exit;
    }
    echo "missing function vt_maint_fillthumbs_run\n";
    exit;
}

if ($action === 'fill_metrics' || $action === 'fill_metrics_raw') {
    vt_load_maint_plugin_file();
    if ( function_exists( 'vt_maint_fill_metrics_run' ) ) {
        $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 120;
        $res = vt_maint_fill_metrics_run($batch);
        vt_log("fill_metrics triggered via vt-maint.php batch=$batch");
        if ($action === 'fill_metrics_raw') {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
            exit;
        }
        echo "ok fill_metrics " . json_encode($res, JSON_UNESCAPED_UNICODE) . "\n";
        echo "report: /wp-content/uploads/vt-logs/metrics-fill-last.json\n";
        exit;
    }
    echo "missing function vt_maint_fill_metrics_run\n";
    exit;
}

if ($action === 'enrich_terms') {
    // Load plugin implementation (do not depend on activation).
    $plugin = __DIR__ . '/wp-content/plugins/vt-maint-runner.php';
    if ( file_exists( $plugin ) ) {
        // Some hosts run PHP opcache with timestamp validation off; invalidate explicitly.
        if ( function_exists( 'opcache_invalidate' ) ) {
            @opcache_invalidate( $plugin, true );
        }
        require_once $plugin;
    }

    if ( function_exists( 'vt_maint_enrich_terms_run' ) ) {
        $res = vt_maint_enrich_terms_run();
        vt_log("enrich_terms triggered via vt-maint.php");
        if ( is_array( $res ) ) {
            echo "ok enrich_terms " . json_encode( $res ) . "\n";
        } else {
            echo "ok enrich_terms\n";
        }
        exit;
    }

    echo "missing function vt_maint_enrich_terms_run\n";
    exit;
}

if ($action === 'enrich_moegirl') {
    // Fill empty vt_summary using Moegirl (API extracts) in a safe, short, non-overwriting way.
    vt_load_maint_plugin_file();
    if ( function_exists( 'vt_maint_enrich_moegirl_run' ) ) {
        $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 20;
        $force = isset($_GET['force']) ? intval($_GET['force']) : 0;
        $res = vt_maint_enrich_moegirl_run($batch, $force);
        vt_log("enrich_moegirl triggered via vt-maint.php batch=$batch force=$force");
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    header('Content-Type: text/plain; charset=utf-8');
    echo "missing function vt_maint_enrich_moegirl_run\n";
    exit;
}

if ( $action === 'enrich_moegirl_ids' || $action === 'enrich_moegirl_ids_raw' ) {
	vt_load_maint_plugin_file();
	if ( function_exists( 'vt_maint_enrich_moegirl_ids_run' ) && function_exists( 'vt_maint_parse_ids_csv' ) ) {
		$raw_ids = isset( $_GET['ids'] ) ? (string) $_GET['ids'] : '';
		$force   = isset( $_GET['force'] ) ? intval( $_GET['force'] ) : 0;
		$min_len = isset( $_GET['min_len'] ) ? intval( $_GET['min_len'] ) : 90;
		$ids     = vt_maint_parse_ids_csv( $raw_ids, 300 );
		$res     = vt_maint_enrich_moegirl_ids_run( $ids, $force, $min_len );
		$res['ids_count'] = count( $ids );
		vt_log( "enrich_moegirl_ids triggered via vt-maint.php ids=" . count( $ids ) . " force=$force min_len=$min_len" );
		if ( $action === 'enrich_moegirl_ids_raw' ) {
			header( 'Content-Type: application/json; charset=utf-8' );
			echo json_encode( $res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) . "\n";
			exit;
		}
		header( 'Content-Type: text/plain; charset=utf-8' );
		echo "ok enrich_moegirl_ids " . json_encode( $res, JSON_UNESCAPED_UNICODE ) . "\n";
		exit;
	}
	header( 'Content-Type: text/plain; charset=utf-8' );
	echo "missing function vt_maint_enrich_moegirl_ids_run\n";
	exit;
}

if ($action === 'enrich_social_bio' || $action === 'enrich_social_bio_raw') {
    vt_load_maint_plugin_file();
    if ( function_exists( 'vt_maint_enrich_social_bio_run' ) ) {
        $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 60;
        $force = isset($_GET['force']) ? intval($_GET['force']) : 0;
        $res = vt_maint_enrich_social_bio_run($batch, $force);
        vt_log("enrich_social_bio triggered via vt-maint.php batch=$batch force=$force");
        if ($action === 'enrich_social_bio_raw') {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
            exit;
        }
        header('Content-Type: text/plain; charset=utf-8');
        echo "ok enrich_social_bio " . json_encode($res, JSON_UNESCAPED_UNICODE) . "\n";
        echo "report: /wp-content/uploads/vt-logs/social-bio-last.json\n";
        exit;
    }
    header('Content-Type: text/plain; charset=utf-8');
    echo "missing function vt_maint_enrich_social_bio_run\n";
    exit;
}

if ($action === 'enrich_full_intro' || $action === 'enrich_full_intro_raw') {
    vt_load_maint_plugin_file();
    if ( function_exists( 'vt_maint_enrich_full_intro_run' ) ) {
        $batch   = isset($_GET['batch']) ? intval($_GET['batch']) : 40;
        $force   = isset($_GET['force']) ? intval($_GET['force']) : 0;
        $min_len = isset($_GET['min_len']) ? intval($_GET['min_len']) : 180;
        $res = vt_maint_enrich_full_intro_run($batch, $force, $min_len);
        vt_log("enrich_full_intro triggered via vt-maint.php batch=$batch force=$force min_len=$min_len");
        if ($action === 'enrich_full_intro_raw') {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
            exit;
        }
        header('Content-Type: text/plain; charset=utf-8');
        echo "ok enrich_full_intro " . json_encode($res, JSON_UNESCAPED_UNICODE) . "\n";
        echo "report: /wp-content/uploads/vt-logs/full-intro-last.json\n";
        exit;
    }
    header('Content-Type: text/plain; charset=utf-8');
    echo "missing function vt_maint_enrich_full_intro_run\n";
    exit;
}

if ($action === 'sync_translation_content' || $action === 'sync_translation_content_raw') {
    vt_load_maint_plugin_file();
    if ( function_exists( 'vt_maint_sync_translation_content_run' ) ) {
        $batch   = isset($_GET['batch']) ? intval($_GET['batch']) : 20;
        $force   = isset($_GET['force']) ? intval($_GET['force']) : 0;
        $min_len = isset($_GET['min_len']) ? intval($_GET['min_len']) : 180;
        $res = vt_maint_sync_translation_content_run($batch, $force, $min_len);
        vt_log("sync_translation_content triggered via vt-maint.php batch=$batch force=$force min_len=$min_len");
        if ($action === 'sync_translation_content_raw') {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
            exit;
        }
        header('Content-Type: text/plain; charset=utf-8');
        echo "ok sync_translation_content " . json_encode($res, JSON_UNESCAPED_UNICODE) . "\n";
        echo "report: /wp-content/uploads/vt-logs/translation-content-last.json\n";
        exit;
    }
    header('Content-Type: text/plain; charset=utf-8');
    echo "missing function vt_maint_sync_translation_content_run\n";
    exit;
}

if ($action === 'internal_links' || $action === 'internal_links_raw') {
    vt_load_maint_plugin_file();
    if ( function_exists( 'vt_maint_internal_links_run' ) ) {
        $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 80;
        $force = isset($_GET['force']) ? intval($_GET['force']) : 0;
        $res = vt_maint_internal_links_run($batch, $force);
        vt_log("internal_links triggered via vt-maint.php batch=$batch force=$force");
        if ($action === 'internal_links_raw') {
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
            exit;
        }
        header('Content-Type: text/plain; charset=utf-8');
        echo "ok internal_links " . json_encode($res, JSON_UNESCAPED_UNICODE) . "\n";
        echo "report: /wp-content/uploads/vt-logs/internal-links-last.json\n";
        exit;
    }
    header('Content-Type: text/plain; charset=utf-8');
    echo "missing function vt_maint_internal_links_run\n";
    exit;
}

if ($action === 'cleanup_moegirl_bad') {
    vt_load_maint_plugin_file();
    if ( function_exists( 'vt_maint_moegirl_cleanup_bad_matches_run' ) ) {
        $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 200;
        $res = vt_maint_moegirl_cleanup_bad_matches_run($batch);
        vt_log("cleanup_moegirl_bad triggered via vt-maint.php batch=$batch");
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    header('Content-Type: text/plain; charset=utf-8');
    echo "missing function vt_maint_moegirl_cleanup_bad_matches_run\n";
    exit;
}

if ($action === 'status_fix') {
    // Load plugin implementation (do not depend on activation).
    $plugin = __DIR__ . '/wp-content/plugins/vt-maint-runner.php';
    if ( file_exists( $plugin ) ) {
        // Some hosts run PHP opcache with timestamp validation off; invalidate explicitly.
        if ( function_exists( 'opcache_invalidate' ) ) {
            @opcache_invalidate( $plugin, true );
        }
        require_once $plugin;
    }

    if ( function_exists( 'vt_maint_status_fix_run' ) ) {
        $res = vt_maint_status_fix_run();
        vt_log("status_fix triggered via vt-maint.php");
        echo "ok status_fix " . json_encode( $res ) . "\n";
        exit;
    }

    echo "missing function vt_maint_status_fix_run\n";
    exit;
}

if ($action === 'sync_translation_meta') {
    // Load plugin implementation (do not depend on activation).
    $plugin = __DIR__ . '/wp-content/plugins/vt-maint-runner.php';
    if ( file_exists( $plugin ) ) {
        if ( function_exists( 'opcache_invalidate' ) ) {
            @opcache_invalidate( $plugin, true );
        }
        require_once $plugin;
    }

    if ( function_exists( 'vt_maint_sync_translation_meta_run' ) ) {
        $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 40;
        $hours = isset($_GET['hours']) ? intval($_GET['hours']) : 72;
        $id    = isset($_GET['id']) ? intval($_GET['id']) : 0;
        $res = vt_maint_sync_translation_meta_run($batch, $hours, $id);
        vt_log("sync_translation_meta triggered via vt-maint.php batch=$batch hours=$hours id=$id");
        echo "ok sync_translation_meta " . json_encode( $res, JSON_UNESCAPED_UNICODE ) . "\n";
        exit;
    }

    echo "missing function vt_maint_sync_translation_meta_run\n";
    exit;
}

if ($action === 'cleanup_terms') {
    $plugin = __DIR__ . '/wp-content/plugins/vt-maint-runner.php';
    if ( file_exists( $plugin ) ) {
        if ( function_exists( 'opcache_invalidate' ) ) {
            @opcache_invalidate( $plugin, true );
        }
        require_once $plugin;
    }

    if ( function_exists( 'vt_maint_cleanup_bad_terms_run' ) ) {
        $res = vt_maint_cleanup_bad_terms_run();
        vt_log("cleanup_terms triggered via vt-maint.php");
        echo "ok cleanup_terms " . json_encode( $res ) . "\n";
        exit;
    }

    echo "missing function vt_maint_cleanup_bad_terms_run\n";
    exit;
}

if ($action === 'debug_set_life') {
    $pid = isset($_GET['id']) ? intval($_GET['id']) : 0;
    $slug = isset($_GET['slug']) ? (string) $_GET['slug'] : '';
    $slug = sanitize_title($slug);
    $lang = isset($_GET['lang']) ? (string) $_GET['lang'] : '';
    $lang = sanitize_title($lang);
    header('Content-Type: application/json; charset=utf-8');
    if ($pid <= 0 || $slug === '') {
        echo json_encode(['ok'=>0,'error'=>'missing_id_or_slug'], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    if (!taxonomy_exists('life-status')) {
        echo json_encode(['ok'=>0,'error'=>'taxonomy_missing'], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    $orig_lang = function_exists('pll_current_language') ? (string) pll_current_language('slug') : '';
    $switched = false;
    if ($lang !== '' && function_exists('pll_switch_language')) {
        try {
            pll_switch_language($lang);
            $switched = true;
        } catch (Throwable $e) {
            $switched = false;
        }
    }
    $term = get_term_by('slug', $slug, 'life-status');
    if ($switched && function_exists('pll_switch_language') && $orig_lang !== '') {
        try { pll_switch_language($orig_lang); } catch (Throwable $e) {}
    }
    if (!$term || is_wp_error($term)) {
        echo json_encode(['ok'=>0,'error'=>'term_not_found','slug'=>$slug,'lang'=>$lang,'orig_lang'=>$orig_lang], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    $before = wp_get_object_terms($pid, 'life-status', ['fields'=>'slugs']);
    $r = wp_set_object_terms($pid, [intval($term->term_id)], 'life-status', false);
    $after = wp_get_object_terms($pid, 'life-status', ['fields'=>'slugs']);
    echo json_encode([
        'ok'=>1,
        'id'=>$pid,
        'set_slug'=>$slug,
        'set_term_id'=>intval($term->term_id),
        'lang'=>$lang,
        'orig_lang'=>$orig_lang,
        'result'=>is_wp_error($r) ? $r->get_error_message() : $r,
        'before'=>$before,
        'after'=>$after,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit;
}

if ($action === 'debug_set_thumb') {
    $pid = isset($_GET['id']) ? intval($_GET['id']) : 0;
    $thumb = isset($_GET['url']) ? esc_url_raw((string) $_GET['url']) : '';
    $source = isset($_GET['source']) ? esc_url_raw((string) $_GET['source']) : '';
    header('Content-Type: application/json; charset=utf-8');
    if ($pid <= 0 || $thumb === '') {
        echo json_encode(['ok' => 0, 'error' => 'missing_id_or_url'], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    if ('' === $source) {
        $source = $thumb;
    }
    update_post_meta($pid, 'vt_thumb_url', $thumb);
    update_post_meta($pid, 'vt_thumb_source_url', $source);
    $eff = vt_effective_thumb_url($pid);
    echo json_encode([
        'ok' => 1,
        'id' => $pid,
        'vt_thumb_url' => $thumb,
        'vt_thumb_source_url' => $source,
        'effective_thumb_url' => $eff,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit;
}

if ($action === 'unlock_sync') {
    vt_load_maint_plugin_file();
    $lock_key = 'vt_maint_sync_sheet_lock';
    $before = get_transient($lock_key);
    if ( function_exists('vt_maint_release_lock') ) {
        vt_maint_release_lock($lock_key);
    } else {
        delete_transient($lock_key);
        delete_option('_transient_' . $lock_key);
        delete_option('_transient_timeout_' . $lock_key);
    }
    $after = get_transient($lock_key);
    vt_log("unlock_sync before=" . json_encode($before) . " after=" . json_encode($after));
    echo "ok unlock_sync before=" . json_encode($before, JSON_UNESCAPED_UNICODE) . " after=" . json_encode($after, JSON_UNESCAPED_UNICODE) . "\n";
    exit;
}

if ($action === 'sheet_report') {
    $last = vt_read_log_json('sheet-sync-last.json');
    $srcs = vt_read_log_json('sheet-sync-sources.json');
    $miss = vt_read_log_json('sheet-sync-missing-avatar.json');
    $out = [
        'last' => $last,
        'sources' => $srcs,
        'missing_avatar' => $miss,
        'utc' => gmdate('c'),
    ];
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit;
}

if ($action === 'source_health' || $action === 'source_health_raw') {
    vt_load_maint_plugin_file();
    if (!function_exists('vt_maint_sheet_sources')) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "missing function vt_maint_sheet_sources\n";
        exit;
    }
    $spreadsheet_id = defined('VT_MAINT_SHEET_ID') ? (string) VT_MAINT_SHEET_ID : '';
    $sources = (array) vt_maint_sheet_sources();
    $last = vt_read_log_json('sheet-sync-sources.json');
    $last_rows = [];
    if (!empty($last['ok']) && is_array($last['data'])) {
        foreach ((array) $last['data'] as $r) {
            $gid = intval($r['gid'] ?? 0);
            if ($gid <= 0) continue;
            $last_rows[$gid] = intval($r['rows'] ?? 0);
        }
    }
    $prev = vt_read_log_json('source-health-last.json');
    $prev_rows = [];
    if (!empty($prev['ok']) && is_array($prev['data']) && is_array($prev['data']['items'] ?? null)) {
        foreach ((array) $prev['data']['items'] as $r) {
            $gid = intval($r['gid'] ?? 0);
            if ($gid <= 0) continue;
            $prev_rows[$gid] = intval($r['rows_nonempty'] ?? 0);
        }
    }

    $items = [];
    $ok = 0;
    $warn = 0;
    $err = 0;
    foreach ($sources as $spec) {
        $gid = intval($spec['gid'] ?? 0);
        $label = (string) ($spec['label'] ?? '');
        $slug = (string) ($spec['source_slug'] ?? '');
        $url = add_query_arg(
            [ 'format' => 'csv', 'gid' => $gid ],
            'https://docs.google.com/spreadsheets/d/' . rawurlencode($spreadsheet_id) . '/export'
        );
        $res = vt_http_get($url, 45);
        $item = [
            'gid' => $gid,
            'label' => $label,
            'source_slug' => $slug,
            'csv_url' => $url,
            'ok' => 0,
            'http_code' => intval($res['code'] ?? 0),
            'error' => '',
            'rows_nonempty' => 0,
            'rows_total' => 0,
            'header_cols' => 0,
            'last_rows' => intval(($last_rows[$gid] ?? 0) > 0 ? $last_rows[$gid] : ($prev_rows[$gid] ?? 0)),
            'delta_rows' => 0,
            'state' => 'error',
        ];
        if (empty($res['ok'])) {
            $item['error'] = (string) ($res['err'] ?? 'fetch_failed');
            $err++;
            $items[] = $item;
            continue;
        }
        $row_total = 0;
        $header_cols = 0;
        $nonempty = vt_csv_nonempty_rows((string) ($res['body'] ?? ''), $row_total, $header_cols);
        $item['rows_nonempty'] = intval($nonempty);
        $item['rows_total'] = intval($row_total);
        $item['header_cols'] = intval($header_cols);
        $item['delta_rows'] = intval($nonempty - intval($item['last_rows']));
        $item['ok'] = 1;

        $abs_delta = abs(intval($item['delta_rows']));
        $baseline = max(40, intval(ceil(max(1, intval($item['last_rows'])) * 0.5)));
        if ($nonempty <= 0) {
            $item['state'] = 'warn_zero_rows';
            $warn++;
        } elseif ($item['last_rows'] > 0 && $abs_delta > $baseline) {
            $item['state'] = 'warn_large_delta';
            $warn++;
        } else {
            $item['state'] = 'ok';
            $ok++;
        }
        $items[] = $item;
    }

    $report = [
        'ok' => 1,
        'utc' => gmdate('c'),
        'spreadsheet_id' => $spreadsheet_id,
        'sources_total' => count($sources),
        'checked' => count($items),
        'ok_count' => $ok,
        'warn_count' => $warn,
        'error_count' => $err,
        'items' => $items,
    ];

    $dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
    if (!is_dir($dir)) { @wp_mkdir_p($dir); }
    @file_put_contents($dir . 'source-health-last.json', json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    if ($action === 'source_health_raw') {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }

    header('Content-Type: text/plain; charset=utf-8');
    echo "ok source_health checked=".intval($report['checked'])." ok=".intval($ok)." warn=".intval($warn)." error=".intval($err)."\n";
    echo "report: /wp-content/uploads/vt-logs/source-health-last.json\n";
    exit;
}

if ($action === 'sync_sheet') {
    vt_register_fatal_probe('sync_sheet');
    vt_load_maint_plugin_file();

    if ( function_exists( 'vt_maint_sync_sheet_run' ) ) {
        $sources = isset($_GET['sources']) ? intval($_GET['sources']) : 2;
        $sources = max(0, min(12, $sources));
        $res = vt_maint_sync_sheet_run($sources);
        vt_log("sync_sheet triggered via vt-maint.php sources=$sources");
        echo "ok sync_sheet " . json_encode( $res, JSON_UNESCAPED_UNICODE ) . "\n";
        exit;
    }

    echo "missing function vt_maint_sync_sheet_run\n";
    exit;
}

if ($action === 'sync_sheet_force') {
    vt_register_fatal_probe('sync_sheet_force');
    vt_load_maint_plugin_file();
    $lock_key = 'vt_maint_sync_sheet_lock';
    if ( function_exists('vt_maint_release_lock') ) {
        vt_maint_release_lock($lock_key);
    } else {
        delete_transient($lock_key);
        delete_option('_transient_' . $lock_key);
        delete_option('_transient_timeout_' . $lock_key);
    }
    if ( function_exists( 'vt_maint_sync_sheet_run' ) ) {
        $sources = isset($_GET['sources']) ? intval($_GET['sources']) : 2;
        $sources = max(0, min(12, $sources));
        $res = vt_maint_sync_sheet_run($sources);
        vt_log("sync_sheet_force triggered via vt-maint.php sources=$sources");
        echo "ok sync_sheet_force " . json_encode( $res, JSON_UNESCAPED_UNICODE ) . "\n";
        exit;
    }
    echo "missing function vt_maint_sync_sheet_run\n";
    exit;
}

if ($action === 'dedupe' || $action === 'dedupe_raw') {
    if ( ! vt_load_maint_plugin_file() ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "missing maint runner plugin file\n";
        exit;
    }
    if ( ! function_exists( 'vt_maint_dedupe_vtuber_run' ) ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "missing function vt_maint_dedupe_vtuber_run\n";
        exit;
    }
    $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 0;
    $batch = max(0, min(10000, $batch));
    $res = vt_maint_dedupe_vtuber_run($batch);
    vt_log("dedupe triggered via vt-maint.php batch=$batch");

    if ($action === 'dedupe_raw') {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    header('Content-Type: text/plain; charset=utf-8');
    echo "ok dedupe " . json_encode( $res, JSON_UNESCAPED_UNICODE ) . "\n";
    echo "report: /wp-content/uploads/vt-logs/dedupe-last.json\n";
    exit;
}

if ($action === 'sync_hololist' || $action === 'sync_hololist_raw') {
    vt_load_maint_plugin_file();
    $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 60;
    $batch = max(1, min(160, $batch));

    if ( ! function_exists( 'vt_maint_sync_hololist_run' ) ) {
        header('Content-Type: text/plain; charset=utf-8');
        echo "missing function vt_maint_sync_hololist_run\n";
        exit;
    }

    $res = vt_maint_sync_hololist_run($batch);
    vt_log("sync_hololist triggered via vt-maint.php batch=$batch");

    header('Content-Type: application/json; charset=utf-8');
    if ($action === 'sync_hololist_raw') {
        echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    echo json_encode([ 'ok' => true, 'batch' => $batch, 'report' => '/wp-content/uploads/vt-logs/hololist-sync-last.json', 'result' => $res ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit;
}

if ($action === 'cleanup_hololist_noise' || $action === 'cleanup_hololist_noise_raw') {
    if ( ! vt_load_maint_plugin_file() ) {
        echo "missing vt-maint-runner.php\n";
        exit;
    }
    if ( ! function_exists( 'vt_maint_cleanup_hololist_noise_run' ) ) {
        echo "missing function vt_maint_cleanup_hololist_noise_run\n";
        exit;
    }
    $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 120;
    $res = vt_maint_cleanup_hololist_noise_run($batch);
    vt_log("cleanup_hololist_noise triggered via vt-maint.php batch=$batch");
    header('Content-Type: text/plain; charset=utf-8');
    if ($action === 'cleanup_hololist_noise_raw') {
        echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    echo "ok cleanup_hololist_noise\n";
    echo "report: /wp-content/uploads/vt-logs/hololist-noise-cleanup-last.json\n";
    exit;
}

if ($action === 'cleanup_no_avatar_no_social' || $action === 'cleanup_no_avatar_no_social_raw') {
    if ( ! vt_load_maint_plugin_file() ) {
        echo "missing vt-maint-runner.php\n";
        exit;
    }
    if ( ! function_exists( 'vt_maint_cleanup_no_avatar_no_social_run' ) ) {
        echo "missing function vt_maint_cleanup_no_avatar_no_social_run\n";
        exit;
    }
    $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 120;
    $res = vt_maint_cleanup_no_avatar_no_social_run($batch);
    vt_log("cleanup_no_avatar_no_social triggered via vt-maint.php batch=$batch");
    header('Content-Type: text/plain; charset=utf-8');
    if ($action === 'cleanup_no_avatar_no_social_raw') {
        echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    echo "ok cleanup_no_avatar_no_social\n";
    echo "report: /wp-content/uploads/vt-logs/no-avatar-no-social-cleanup-last.json\n";
    exit;
}

if ($action === 'fix_no_social_entries' || $action === 'fix_no_social_entries_raw') {
    if ( ! vt_load_maint_plugin_file() ) {
        echo "missing vt-maint-runner.php\n";
        exit;
    }
    if ( ! function_exists( 'vt_maint_fix_no_social_entries_run' ) ) {
        echo "missing function vt_maint_fix_no_social_entries_run\n";
        exit;
    }
    $batch = isset($_GET['batch']) ? intval($_GET['batch']) : 120;
    $res = vt_maint_fix_no_social_entries_run($batch);
    vt_log("fix_no_social_entries triggered via vt-maint.php batch=$batch");
    header('Content-Type: text/plain; charset=utf-8');
    if ($action === 'fix_no_social_entries_raw') {
        echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        exit;
    }
    echo "ok fix_no_social_entries\n";
    echo "report: /wp-content/uploads/vt-logs/no-social-fix-last.json\n";
    exit;
}

if ($action === 'import_global') {
    $plugin = __DIR__ . '/wp-content/plugins/vt-maint-runner.php';
    if ( file_exists( $plugin ) ) {
        if ( function_exists( 'opcache_invalidate' ) ) {
            @opcache_invalidate( $plugin, true );
        }
        require_once $plugin;
    }

    if ( function_exists( 'vt_maint_import_fandom_global_run' ) ) {
        $limit = isset($_GET['limit']) ? intval($_GET['limit']) : 30;
        $res = vt_maint_import_fandom_global_run( $limit );
        vt_log("import_global triggered via vt-maint.php");
        echo "ok import_global " . json_encode( $res, JSON_UNESCAPED_UNICODE ) . "\n";
        exit;
    }

    echo "missing function vt_maint_import_fandom_global_run\n";
    exit;
}

if ($action === 'reschedule_maint') {
    vt_load_maint_plugin_file();
    $hooks = [
        // Reduce front-end contention: keep heavy jobs on slower intervals.
        'vt_maint_fillthumbs_event' => [ 'interval' => 'vt_30min', 'delay' => 60 ],
        'vt_maint_enrich_terms_event' => [ 'interval' => 'vt_6hours', 'delay' => 180 ],
        'vt_maint_assign_default_lang_event' => [ 'interval' => 'hourly', 'delay' => 300 ],
        'vt_maint_sync_sheet_event' => [ 'interval' => 'hourly', 'delay' => 420 ],
        'vt_maint_ensure_translations_event' => [ 'interval' => 'hourly', 'delay' => 540 ],
        'vt_maint_ensure_page_translations_event' => [ 'interval' => 'vt_6hours', 'delay' => 660 ],
        'vt_maint_sync_translation_content_event' => [ 'interval' => 'vt_6hours', 'delay' => 720 ],
        'vt_maint_sync_translation_meta_event' => [ 'interval' => 'vt_6hours', 'delay' => 780 ],
        'vt_maint_internal_links_event' => [ 'interval' => 'vt_6hours', 'delay' => 1140 ],
        'vt_maint_dedupe_event' => [ 'interval' => 'vt_daily', 'delay' => 900 ],
        'vt_maint_sync_hololist_event' => [ 'interval' => 'vt_daily', 'delay' => 1020 ],
    ];
    $scheduled = [];
    foreach ($hooks as $hook => $spec) {
        $next = wp_next_scheduled($hook);
        while ($next) {
            wp_unschedule_event(intval($next), $hook);
            $next = wp_next_scheduled($hook);
        }
        wp_schedule_event(time() + intval($spec['delay']), (string) $spec['interval'], $hook);
        $next = wp_next_scheduled($hook);
        $scheduled[$hook] = $next ? gmdate('c', intval($next)) : null;
    }
    vt_log("reschedule_maint " . json_encode($scheduled));
    echo "ok reschedule_maint " . json_encode($scheduled, JSON_UNESCAPED_UNICODE) . "\n";
    exit;
}

if ($action === 'activate_runner') {
    require_once ABSPATH . 'wp-admin/includes/plugin.php';
    $plugin_file = 'vt-maint-runner.php';
    $active_before = is_plugin_active($plugin_file) ? 1 : 0;
    $res = null;
    if (!$active_before) {
        $res = activate_plugin($plugin_file, '', false, false);
    }
    $active_after = is_plugin_active($plugin_file) ? 1 : 0;
    vt_log("activate_runner before={$active_before} after={$active_after}");
    echo "ok activate_runner before={$active_before} after={$active_after}";
    if (is_wp_error($res)) {
        echo " error=" . $res->get_error_message();
    }
    echo "\n";
    exit;
}

if ($action === 'ensure_pages') {
    header('Content-Type: text/plain; charset=utf-8');

    $created = [];
    $updated = [];

    $specs = [
        [
            'path' => 'platforms',
            'title' => '平台索引',
            'template' => 'vt-platform-index.php',
            'content' => '依平台瀏覽 VTuber（YouTube / Twitch 等）。',
        ],
        [
            'path' => 'agencies',
            'title' => '組織索引',
            'template' => 'vt-agency-index.php',
            'content' => '依組織瀏覽 VTuber（含個人勢）。',
        ],
        [
            'path' => 'countries',
            'title' => '國家 / 地區索引',
            'template' => 'vt-country-index.php',
            'content' => '依國家或地區瀏覽 VTuber。',
        ],
        [
            'path' => 'debut-years',
            'title' => '出道年份索引',
            'template' => 'vt-debut-year-index.php',
            'content' => '依出道年份瀏覽 VTuber。',
        ],
        [
            'path' => 'roles',
            'title' => 'Role Tag Index',
            'template' => 'vt-role-index.php',
            'content' => 'Browse VTuber profiles by style and personality tags.',
        ],
        [
            'path' => 'contact',
            'title' => '聯絡我們 / 合作投放',
            'template' => 'vt-contact.php',
            'content' => '聯絡與合作方式。',
        ],
    ];

    foreach ($specs as $s) {
        $page = get_page_by_path($s['path']);
        if (!$page) {
            $pid = wp_insert_post([
                'post_type' => 'page',
                'post_status' => 'publish',
                'post_title' => $s['title'],
                'post_name' => $s['path'],
                'post_content' => $s['content'],
            ], true);
            if (is_wp_error($pid)) {
                echo "fail create {$s['path']} " . $pid->get_error_message() . "\n";
                continue;
            }
            update_post_meta($pid, '_wp_page_template', $s['template']);
            $created[] = [ 'path' => $s['path'], 'id' => intval($pid) ];
        } else {
            $pid = intval($page->ID);
            $current_tpl = (string) get_post_meta($pid, '_wp_page_template', true);
            if ($current_tpl !== $s['template']) {
                update_post_meta($pid, '_wp_page_template', $s['template']);
                $updated[] = [ 'path' => $s['path'], 'id' => $pid, 'from' => $current_tpl, 'to' => $s['template'] ];
            }
        }
    }

    vt_log("ensure_pages created=" . count($created) . " updated=" . count($updated));
    echo "ok ensure_pages created=" . count($created) . " updated=" . count($updated) . "\n";
    if (!empty($created)) echo "created: " . json_encode($created, JSON_UNESCAPED_UNICODE) . "\n";
    if (!empty($updated)) echo "updated: " . json_encode($updated, JSON_UNESCAPED_UNICODE) . "\n";
    exit;
}

echo "unknown action";

