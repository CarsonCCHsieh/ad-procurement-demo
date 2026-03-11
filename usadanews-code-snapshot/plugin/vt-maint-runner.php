<?php
/**
 * Plugin Name: VT Maint Runner
 * Description: Auto-fill thumbnails + enrich taxonomy tags for VTuber entries. Runs in batches with locking + logs.
 * Version: 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Bump to re-run enrichment logic on all posts (stored per post meta).
if ( ! defined( 'VT_MAINT_TERMS_VERSION' ) ) {
	// Bump to force re-processing enrichment logic on legacy posts.
	// v6: role-tag cleanup (remove status-like tags), enforce single life-status term per post.
	define( 'VT_MAINT_TERMS_VERSION', 6 );
}
if ( ! defined( 'VT_MAINT_TERMS_BATCH' ) ) {
	// Large enough to finish backfills in reasonable time, still safe on shared hosting.
	define( 'VT_MAINT_TERMS_BATCH', 120 );
}
if ( ! defined( 'VT_MAINT_SHEET_ID' ) ) {
	define( 'VT_MAINT_SHEET_ID', '1PakEIlnG_4Qo29LLNimplumvZSjN4DwDelQ551fIl3E' );
}
if ( ! defined( 'VT_MAINT_SHEETS_API_KEY' ) ) {
	define( 'VT_MAINT_SHEETS_API_KEY', '' );
}

// GSC keyword import file path (uploaded by maintain scripts). This file must not contain secrets.
if ( ! defined( 'VT_MAINT_GSC_QUERIES_FILE' ) ) {
	define( 'VT_MAINT_GSC_QUERIES_FILE', WP_CONTENT_DIR . '/uploads/vt-logs/gsc-queries.json' );
}

function vt_maint_sheet_sources() {
	return [
		[
			'gid'              => 1575066064,
			'label'            => 'Taiwan VTuber (main)',
			'source_slug'      => 'tw-main-reincarnated',
			'origin'           => 'tw_sheet',
			'country_code'     => 'TW',
			'country_name'     => '台灣',
			'default_lifecycle'=> 'active',
			'role_tags'        => [ '台灣VTuber' ],
		],
		[
			'gid'              => 1406516665,
			'label'            => 'Taiwan VTuber (Twitch main)',
			'source_slug'      => 'tw-main-twitch',
			'origin'           => 'tw_sheet',
			'country_code'     => 'TW',
			'country_name'     => '台灣',
			'default_lifecycle'=> 'active',
			'role_tags'        => [ '台灣VTuber', 'Twitch主' ],
		],
		[
			'gid'              => 318638248,
			'label'            => 'Taiwan VTuber (special music/video)',
			'source_slug'      => 'tw-special-video',
			'origin'           => 'tw_sheet',
			'country_code'     => 'TW',
			'country_name'     => '台灣',
			'default_lifecycle'=> 'active',
			'role_tags'        => [ '台灣VTuber', '音樂', '影片勢' ],
		],
		[
			'gid'              => 1961441865,
			'label'            => 'Taiwan VTuber (pre-debut)',
			'source_slug'      => 'tw-preparing',
			'origin'           => 'tw_sheet',
			'country_code'     => 'TW',
			'country_name'     => '台灣',
			'default_lifecycle'=> 'active',
			'role_tags'        => [ '台灣VTuber', '準備中' ],
		],
		[
			'gid'              => 1561118585,
			'label'            => 'Taiwan VTuber (non-official debut)',
			'source_slug'      => 'tw-unofficial-debut',
			'origin'           => 'tw_sheet',
			'country_code'     => 'TW',
			'country_name'     => '台灣',
			'default_lifecycle'=> 'active',
			'role_tags'        => [ '台灣VTuber', '非正式出道' ],
		],
		[
			'gid'              => 60192887,
			'label'            => 'Taiwan VTuber (hiatus / irregular)',
			'source_slug'      => 'tw-hiatus',
			'origin'           => 'tw_sheet',
			'country_code'     => 'TW',
			'country_name'     => '台灣',
			'default_lifecycle'=> 'hiatus',
			// Status is represented by life-status taxonomy; avoid duplicating status in role tags.
			'role_tags'        => [ '台灣VTuber' ],
		],
		[
			'gid'              => 470068163,
			'label'            => 'Taiwan VTuber (archive / graduated)',
			'source_slug'      => 'tw-archive',
			'origin'           => 'tw_sheet',
			'country_code'     => 'TW',
			'country_name'     => '台灣',
			'default_lifecycle'=> 'graduated',
			// Status is represented by life-status taxonomy; avoid duplicating status in role tags.
			'role_tags'        => [ '台灣VTuber' ],
		],
	];
}

// Custom interval 10 minutes.
add_filter( 'cron_schedules', function ( $schedules ) {
	$schedules['vt_10min'] = [
		'interval' => 600,
		'display'  => 'Every 10 Minutes',
	];
	$schedules['vt_30min'] = [
		'interval' => 1800,
		'display'  => 'Every 30 Minutes',
	];
	$schedules['vt_2min'] = [
		'interval' => 120,
		'display'  => 'Every 2 Minutes',
	];
	$schedules['vt_daily'] = [
		'interval' => DAY_IN_SECONDS,
		'display'  => 'Daily',
	];
	$schedules['vt_6hours'] = [
		'interval' => 21600,
		'display'  => 'Every 6 Hours',
	];
	return $schedules;
} );

// Schedule on activation.
register_activation_hook( __FILE__, function () {
	if ( ! wp_next_scheduled( 'vt_maint_fillthumbs_event' ) ) {
		wp_schedule_event( time() + 60, 'vt_30min', 'vt_maint_fillthumbs_event' );
	}
	if ( ! wp_next_scheduled( 'vt_maint_enrich_terms_event' ) ) {
		wp_schedule_event( time() + 180, 'vt_6hours', 'vt_maint_enrich_terms_event' );
	}
	if ( ! wp_next_scheduled( 'vt_maint_assign_default_lang_event' ) ) {
		wp_schedule_event( time() + 300, 'hourly', 'vt_maint_assign_default_lang_event' );
	}
	if ( ! wp_next_scheduled( 'vt_maint_sync_sheet_event' ) ) {
		wp_schedule_event( time() + 420, 'hourly', 'vt_maint_sync_sheet_event' );
	}
	if ( ! wp_next_scheduled( 'vt_maint_ensure_translations_event' ) ) {
		wp_schedule_event( time() + 540, 'hourly', 'vt_maint_ensure_translations_event' );
	}
	if ( ! wp_next_scheduled( 'vt_maint_ensure_page_translations_event' ) ) {
		wp_schedule_event( time() + 660, 'vt_6hours', 'vt_maint_ensure_page_translations_event' );
	}
	if ( ! wp_next_scheduled( 'vt_maint_sync_translation_content_event' ) ) {
		wp_schedule_event( time() + 720, 'vt_6hours', 'vt_maint_sync_translation_content_event' );
	}
	if ( ! wp_next_scheduled( 'vt_maint_sync_hololist_event' ) ) {
		wp_schedule_event( time() + 1020, 'vt_daily', 'vt_maint_sync_hololist_event' );
	}
	if ( ! wp_next_scheduled( 'vt_maint_dedupe_event' ) ) {
		wp_schedule_event( time() + 900, 'vt_daily', 'vt_maint_dedupe_event' );
	}
	// Keep translated pages consistent (meta + taxonomy) for authoritative sources.
	if ( ! wp_next_scheduled( 'vt_maint_sync_translation_meta_event' ) ) {
		wp_schedule_event( time() + 780, 'vt_6hours', 'vt_maint_sync_translation_meta_event' );
	}
	// Build internal links in summaries for SEO/entity graph.
	if ( ! wp_next_scheduled( 'vt_maint_internal_links_event' ) ) {
		wp_schedule_event( time() + 1140, 'vt_6hours', 'vt_maint_internal_links_event' );
	}
} );

// Clear on deactivation.
register_deactivation_hook( __FILE__, function () {
	foreach ( [ 'vt_maint_fillthumbs_event', 'vt_maint_enrich_terms_event', 'vt_maint_assign_default_lang_event', 'vt_maint_sync_sheet_event', 'vt_maint_ensure_translations_event', 'vt_maint_ensure_page_translations_event', 'vt_maint_sync_translation_content_event', 'vt_maint_sync_hololist_event', 'vt_maint_dedupe_event', 'vt_maint_sync_translation_meta_event', 'vt_maint_internal_links_event' ] as $hook ) {
		$ts = wp_next_scheduled( $hook );
		while ( $ts ) {
			wp_unschedule_event( $ts, $hook );
			$ts = wp_next_scheduled( $hook );
		}
	}
} );

add_action( 'vt_maint_fillthumbs_event', 'vt_maint_fillthumbs_run' );
add_action( 'vt_maint_enrich_terms_event', 'vt_maint_enrich_terms_run' );
add_action( 'vt_maint_assign_default_lang_event', 'vt_maint_assign_default_lang_run' );
function vt_maint_sync_sheet_event_run() {
	return vt_maint_sync_sheet_run( 2 );
}
function vt_maint_ensure_translations_event_run() {
	// Keep background translation sync lightweight to avoid frontend latency spikes.
	return vt_maint_ensure_translations_run( 20 );
}
function vt_maint_ensure_page_translations_event_run() {
	return vt_maint_ensure_page_translations_run();
}
function vt_maint_sync_translation_content_event_run() {
	return vt_maint_sync_translation_content_run( 20, 0, 160 );
}
function vt_maint_internal_links_event_run() {
	return vt_maint_internal_links_run( 80, 0 );
}
add_action( 'vt_maint_sync_sheet_event', 'vt_maint_sync_sheet_event_run' );
add_action( 'vt_maint_ensure_translations_event', 'vt_maint_ensure_translations_event_run' );
add_action( 'vt_maint_ensure_page_translations_event', 'vt_maint_ensure_page_translations_event_run' );
add_action( 'vt_maint_sync_translation_content_event', 'vt_maint_sync_translation_content_event_run' );
add_action( 'vt_maint_sync_hololist_event', 'vt_maint_sync_hololist_run' );
add_action( 'vt_maint_dedupe_event', 'vt_maint_dedupe_vtuber_run' );
add_action( 'vt_maint_sync_translation_meta_event', 'vt_maint_sync_translation_meta_run' );
add_action( 'vt_maint_internal_links_event', 'vt_maint_internal_links_event_run' );

function vt_maint_log( $msg ) {
	$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
	if ( ! is_dir( $dir ) ) {
		wp_mkdir_p( $dir );
	}
	$file = $dir . 'maint-runner.log';
	@file_put_contents( $file, gmdate( 'c' ) . ' ' . $msg . "\n", FILE_APPEND );
}

function vt_maint_acquire_lock( $lock_key, $ttl = 600, $stale_after = 3600 ) {
	$current = get_transient( $lock_key );
	if ( is_array( $current ) ) {
		$started = intval( $current['started'] ?? 0 );
		if ( $started > 0 && ( time() - $started ) > $stale_after ) {
			delete_transient( $lock_key );
			$current = false;
		}
	} elseif ( ! empty( $current ) ) {
		$timeout = intval( get_option( '_transient_timeout_' . $lock_key, 0 ) );
		if ( $timeout > 0 && $timeout < ( time() - 60 ) ) {
			delete_transient( $lock_key );
			$current = false;
		}
	}
	if ( ! empty( $current ) ) {
		return false;
	}
	set_transient(
		$lock_key,
		[
			'started' => time(),
			'token'   => wp_generate_password( 16, false, false ),
		],
		max( 120, intval( $ttl ) )
	);
	return true;
}

function vt_maint_release_lock( $lock_key ) {
	delete_transient( $lock_key );
	delete_option( '_transient_' . $lock_key );
	delete_option( '_transient_timeout_' . $lock_key );
}

/**
 * Ensure our cron events exist even if the file was replaced during deployment.
 */
	add_action(
		'init',
		function () {
		if ( ! wp_next_scheduled( 'vt_maint_fillthumbs_event' ) ) {
			wp_schedule_event( time() + 60, 'vt_30min', 'vt_maint_fillthumbs_event' );
		}
		if ( ! wp_next_scheduled( 'vt_maint_enrich_terms_event' ) ) {
			wp_schedule_event( time() + 180, 'vt_6hours', 'vt_maint_enrich_terms_event' );
		}
		if ( ! wp_next_scheduled( 'vt_maint_assign_default_lang_event' ) ) {
			wp_schedule_event( time() + 300, 'hourly', 'vt_maint_assign_default_lang_event' );
		}
		if ( ! wp_next_scheduled( 'vt_maint_sync_sheet_event' ) ) {
			wp_schedule_event( time() + 420, 'hourly', 'vt_maint_sync_sheet_event' );
		}
		if ( ! wp_next_scheduled( 'vt_maint_ensure_translations_event' ) ) {
			wp_schedule_event( time() + 540, 'hourly', 'vt_maint_ensure_translations_event' );
		}
		if ( ! wp_next_scheduled( 'vt_maint_ensure_page_translations_event' ) ) {
			wp_schedule_event( time() + 660, 'vt_6hours', 'vt_maint_ensure_page_translations_event' );
		}
		if ( ! wp_next_scheduled( 'vt_maint_sync_translation_content_event' ) ) {
			wp_schedule_event( time() + 720, 'vt_6hours', 'vt_maint_sync_translation_content_event' );
		}
		if ( ! wp_next_scheduled( 'vt_maint_internal_links_event' ) ) {
			wp_schedule_event( time() + 1140, 'vt_6hours', 'vt_maint_internal_links_event' );
		}
			if ( ! wp_next_scheduled( 'vt_maint_sync_hololist_event' ) ) {
				wp_schedule_event( time() + 1020, 'vt_daily', 'vt_maint_sync_hololist_event' );
			}
			if ( ! wp_next_scheduled( 'vt_maint_dedupe_event' ) ) {
				wp_schedule_event( time() + 900, 'vt_daily', 'vt_maint_dedupe_event' );
			}
		}
	);

function vt_maint_target_lang_slugs() {
	// Target languages (directory prefixes). Default language has no prefix.
	// Keep this aligned with the site's SEO plan (cn/ja/en/ko/es/hi).
	return [ 'cn', 'ja', 'en', 'ko', 'es', 'hi' ];
}

function vt_maint_default_lang_slug() {
	if ( function_exists( 'pll_default_language' ) ) {
		$slug = (string) pll_default_language( 'slug' );
		if ( $slug !== '' ) {
			return $slug;
		}
	}
	return 'zh';
}

function vt_maint_language_term_id_by_slug( $slug ) {
	$slug = sanitize_title( (string) $slug );
	if ( $slug === '' ) {
		return 0;
	}
	if ( function_exists( 'PLL' ) ) {
		try {
			$lang = PLL()->model->get_language( $slug );
			if ( is_object( $lang ) && isset( $lang->term_id ) ) {
				return intval( $lang->term_id );
			}
		} catch ( Throwable $e ) {
			// ignore
		}
	}
	$t = get_term_by( 'slug', $slug, 'language' );
	if ( $t && ! is_wp_error( $t ) ) {
		return intval( $t->term_id );
	}
	return 0;
}

/**
 * Assign default language to VTuber posts that have no Polylang language term.
 *
 * Without this, /vtuber/ (default language, no prefix) can appear empty even though
 * content exists, because Polylang filters out posts without a language.
 */
function vt_maint_assign_default_lang_run( $batch = 300 ) {
	$lock_key = 'vt_maint_assign_default_lang_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 120, 3600 ) ) {
		return;
	}

	try {
		$batch   = max( 50, min( 800, intval( $batch ) ) );
		$default = vt_maint_default_lang_slug();
		$term_id = vt_maint_language_term_id_by_slug( $default );
		if ( $term_id <= 0 ) {
			vt_maint_log( 'assign_default_lang missing_term slug=' . $default );
			return;
		}

		global $wpdb;
		$posts = $wpdb->posts;
		$tr    = $wpdb->term_relationships;
		$tt    = $wpdb->term_taxonomy;

		// Find VTuber posts with NO language relationship (taxonomy = language).
		// Use NOT EXISTS to avoid false positives when the post has other taxonomy terms.
		$sql = $wpdb->prepare(
			"
			SELECT p.ID
			FROM $posts p
			WHERE p.post_type = 'vtuber' AND p.post_status = 'publish'
			  AND NOT EXISTS (
			    SELECT 1
			    FROM $tr r
			    JOIN $tt t ON t.term_taxonomy_id = r.term_taxonomy_id
			    WHERE r.object_id = p.ID AND t.taxonomy = 'language'
			  )
			ORDER BY p.ID ASC
			LIMIT %d
			",
			$batch
		);
		$ids = $wpdb->get_col( $sql );
		$ids = array_map( 'intval', (array) $ids );
		$ids = array_values( array_filter( $ids ) );

		$updated = 0;
		foreach ( $ids as $pid ) {
			$r = wp_set_object_terms( $pid, [ $term_id ], 'language', false );
			if ( ! is_wp_error( $r ) ) {
				$updated++;
			}
		}

		$report = [
			'utc'        => gmdate( 'c' ),
			'default'    => $default,
			'term_id'    => $term_id,
			'checked'    => count( $ids ),
			'updated'    => $updated,
			'sample_ids' => array_slice( $ids, 0, 20 ),
		];
		$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		@file_put_contents( $dir . 'lang-assign-last.json', json_encode( $report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
		vt_maint_log( 'assign_default_lang checked=' . count( $ids ) . ' updated=' . $updated . ' default=' . $default );
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_copy_vt_meta( $from_id, $to_id ) {
	$from_id = intval( $from_id );
	$to_id   = intval( $to_id );
	if ( $from_id <= 0 || $to_id <= 0 ) {
		return;
	}

	$meta = get_post_meta( $from_id );
	foreach ( $meta as $k => $vals ) {
		$k = (string) $k;
		if ( $k === '' ) {
			continue;
		}

		// Copy VT fields and thumbnail. Avoid copying Polylang internals.
		$copy = ( strpos( $k, 'vt_' ) === 0 ) || ( $k === '_thumbnail_id' );
		if ( ! $copy ) {
			continue;
		}
		if ( strpos( $k, '_pll_' ) === 0 ) {
			continue;
		}

		delete_post_meta( $to_id, $k );
		foreach ( (array) $vals as $v ) {
			add_post_meta( $to_id, $k, maybe_unserialize( $v ) );
		}
	}
}

function vt_maint_copy_vt_terms( $from_id, $to_id ) {
	$from_id = intval( $from_id );
	$to_id   = intval( $to_id );
	if ( $from_id <= 0 || $to_id <= 0 ) {
		return;
	}

	// When syncing across Polylang languages, some taxonomies should be mapped by slug (per-language)
	// instead of copying raw term IDs. Otherwise an English page might show Chinese labels.
	$to_lang = '';
	if ( function_exists( 'pll_get_post_language' ) ) {
		$to_lang = (string) pll_get_post_language( $to_id, 'slug' );
	}

	$taxes = [ 'agency', 'platform', 'role-tag', 'franchise', 'life-status', 'country', 'debut-year' ];
	foreach ( $taxes as $tax ) {
		$tax = (string) $tax;

		// Special handling: life-status has per-language slugs (hiatus-en, graduated-cn, ...)
		// We map from the source canonical slug to the target language-specific slug.
		if ( 'life-status' === $tax && taxonomy_exists( 'life-status' ) ) {
			$src_terms = wp_get_object_terms( $from_id, 'life-status' );
			if ( is_wp_error( $src_terms ) || empty( $src_terms ) ) {
				wp_set_object_terms( $to_id, [], 'life-status', false );
				continue;
			}
			$t0   = reset( $src_terms );
			$raw  = ( $t0 && ! empty( $t0->slug ) ) ? (string) $t0->slug : '';
			$base = vt_maint_normalize_life_slug( $raw );
			$want = vt_maint_life_slug_for_post_lang( $base, $to_lang );

			// Polylang can hide terms from `get_term_by` when current request language differs.
			// Use a raw DB lookup by slug to get a stable term_id, then assign by ID.
			$tid = vt_maint_term_id_by_slug_raw( 'life-status', $want );
			if ( $tid <= 0 ) {
				$tid = vt_maint_term_id_by_slug_raw( 'life-status', $base );
			}
			if ( $tid > 0 ) {
				$r = wp_set_object_terms( $to_id, [ intval( $tid ) ], 'life-status', false );
				if ( is_wp_error( $r ) ) {
					vt_maint_log( 'copy_terms life-status set_error post=' . $to_id . ' want=' . $want . ' err=' . $r->get_error_message() );
				}
			}
			continue;
		}

		$terms = wp_get_object_terms( $from_id, $tax, [ 'fields' => 'ids' ] );
		if ( is_wp_error( $terms ) ) {
			continue;
		}
		wp_set_object_terms( $to_id, array_map( 'intval', (array) $terms ), $tax, false );
	}
}

function vt_maint_read_json_file( $path ) {
	$path = (string) $path;
	if ( '' === $path || ! file_exists( $path ) ) {
		return null;
	}
	$txt = @file_get_contents( $path );
	if ( ! is_string( $txt ) || '' === trim( $txt ) ) {
		return null;
	}
	$j = json_decode( $txt, true );
	return is_array( $j ) ? $j : null;
}

function vt_maint_write_log_json( $name, $data ) {
	$dir = WP_CONTENT_DIR . '/uploads/vt-logs';
	if ( ! is_dir( $dir ) ) {
		@wp_mkdir_p( $dir );
	}
	$fp = $dir . '/' . ltrim( (string) $name, '/' );
	@file_put_contents( $fp, wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
	return $fp;
}

/**
 * Filter out noisy/unhelpful GSC queries.
 *
 * Example noise observed on new sites:
 * - "youtube10300", "youtube 81777", "youtuber56600"
 */
function vt_maint_is_noise_gsc_query( $query ) {
	$q = trim( (string) $query );
	if ( '' === $q ) {
		return true;
	}
	// Remove common invisible characters / BOM that may pollute matching.
	$q = preg_replace( '/[\x{FEFF}\x{200B}\x{200C}\x{200D}\x{2060}]/u', '', $q );
	$q = trim( (string) $q );
	if ( '' === $q ) {
		return true;
	}
	$q_norm = preg_replace( '/\s+/u', ' ', $q );
	$q_norm = trim( (string) $q_norm );
	$lower  = function_exists( 'mb_strtolower' ) ? mb_strtolower( $q_norm, 'UTF-8' ) : strtolower( $q_norm );
	if ( '' === $lower ) {
		return true;
	}
	// Very short / meaningless tokens.
	$len = function_exists( 'mb_strlen' ) ? mb_strlen( $lower, 'UTF-8' ) : strlen( $lower );
	if ( $len < 2 ) {
		return true;
	}
	// Null/test placeholders.
	if ( in_array( $lower, [ 'null', 'none', 'undefined', 'nan', 'test', 'testing', 'n/a' ], true ) ) {
		return true;
	}
	// Raw URL-like queries are usually noise for on-page keyword chips.
	if ( preg_match( '#^https?://#iu', $lower ) ) {
		return true;
	}
	// Pure numeric-ish queries (optionally with separators) are noise.
	$digits_only = preg_replace( '/[\s\-_:#,.]/u', '', $lower );
	if ( '' !== $digits_only && preg_match( '/^\d+$/u', $digits_only ) ) {
		return true;
	}

	// youtube + 5+ digits (with/without spaces/separators): youtube10300 / youtube 10300 / youtuber-56600
	if ( preg_match( '/^(?:youtube|youtuber)\s*[-_:#]?\s*\d{5,}$/u', $lower ) ) {
		return true;
	}
	// yt + 5+ digits: yt12345
	if ( preg_match( '/^yt\s*[-_:#]?\s*\d{5,}$/u', $lower ) ) {
		return true;
	}
	// Variants like "youtube 10300 訂閱" / "youtuber-56600ch": strip brand token + separators.
	$compact = preg_replace( '/(?:youtube|youtuber|yt)/u', '', $lower );
	$compact = preg_replace( '/[\s\-_:#]+/u', '', (string) $compact );
	$compact = trim( (string) $compact );
	if ( '' !== $compact && preg_match( '/^\d{4,}(?:ch|subs?|followers?)?$/u', $compact ) ) {
		return true;
	}
	// Broader social+digits noise: twitch12345 / twitter 778899 / x-123456
	if ( preg_match( '/^(?:twitch|twitter|x)\s*[-_:#]?\s*\d{4,}(?:ch|subs?|followers?)?$/u', $lower ) ) {
		return true;
	}
	// "youtube 12345 訂閱" / "yt 99999 followers" / "youtuber 54321 ch"
	if ( preg_match( '/(?:youtube|youtuber|yt)\s*[-_:#]?\s*\d{4,}\s*(?:ch|channel|subs?|followers?|訂閱|追蹤)?$/u', $lower ) ) {
		return true;
	}

	return false;
}

/**
 * Canonicalize query for dedupe:
 * - lowercase
 * - normalize whitespace
 * - remove punctuation-ish separators
 */
function vt_maint_canonicalize_gsc_query( $query ) {
	$q = trim( (string) $query );
	if ( '' === $q ) {
		return '';
	}
	$q = preg_replace( '/[\x{FEFF}\x{200B}\x{200C}\x{200D}\x{2060}]/u', '', $q );
	$q = preg_replace( '/\s+/u', ' ', (string) $q );
	$q = trim( (string) $q );
	if ( '' === $q ) {
		return '';
	}
	$q = vt_maint_lower( $q );
	$q = preg_replace( '/[[:punct:]]+/u', ' ', (string) $q );
	$q = preg_replace( '/\s+/u', ' ', (string) $q );
	$q = trim( (string) $q );
	return $q;
}

function vt_maint_is_internal_site_url( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return false;
	}
	$home = home_url( '/' );
	$u = wp_parse_url( $url );
	$h = wp_parse_url( $home );
	if ( ! is_array( $u ) || empty( $u['host'] ) ) {
		return false;
	}
	if ( ! is_array( $h ) || empty( $h['host'] ) ) {
		return true;
	}
	return ( strtolower( (string) $u['host'] ) === strtolower( (string) $h['host'] ) );
}

function vt_maint_seo_keywords_import_run( $limit = 80 ) {
	$limit = max( 10, intval( $limit ) );

	$data = vt_maint_read_json_file( VT_MAINT_GSC_QUERIES_FILE );
	if ( ! is_array( $data ) ) {
		return [
			'ok'      => 0,
			'reason'  => 'missing_or_invalid_json',
			'file'    => VT_MAINT_GSC_QUERIES_FILE,
			'updated' => 0,
		];
	}

	$rows = [];
	if ( isset( $data['rows'] ) && is_array( $data['rows'] ) ) {
		$rows = $data['rows'];
	} elseif ( isset( $data['data']['rows'] ) && is_array( $data['data']['rows'] ) ) {
		$rows = $data['data']['rows'];
	} elseif ( is_array( $data ) ) {
		$rows = $data;
	}

	$out = [];
	foreach ( $rows as $r ) {
		if ( ! is_array( $r ) ) {
			continue;
		}
		$q = trim( (string) ( $r['query'] ?? $r['q'] ?? '' ) );
		$page = trim( (string) ( $r['page'] ?? $r['url'] ?? '' ) );
		$clicks = floatval( $r['clicks'] ?? 0 );
		$impr   = floatval( $r['impressions'] ?? 0 );
		$pos    = floatval( $r['position'] ?? 0 );
		if ( '' === $q ) {
			continue;
		}
		if ( $clicks <= 0 && $impr <= 0 ) {
			continue;
		}
		if ( '' !== $page && ! vt_maint_is_internal_site_url( $page ) ) {
			continue;
		}
		// Basic query sanitization: collapse whitespace.
		$q = preg_replace( '/\\s+/u', ' ', $q );
		$q = trim( (string) $q );
		if ( '' === $q ) {
			continue;
		}
		if ( vt_maint_is_noise_gsc_query( $q ) ) {
			continue;
		}

		$out[] = [
			'query'       => $q,
			'page'        => $page,
			'clicks'      => $clicks,
			'impressions' => $impr,
			'position'    => $pos,
		];
		if ( count( $out ) >= $limit * 3 ) {
			break;
		}
	}

	usort(
		$out,
		function ( $a, $b ) {
			$ac = floatval( $a['clicks'] ?? 0 );
			$bc = floatval( $b['clicks'] ?? 0 );
			if ( $ac === $bc ) {
				$ai = floatval( $a['impressions'] ?? 0 );
				$bi = floatval( $b['impressions'] ?? 0 );
				return $bi <=> $ai;
			}
			return $bc <=> $ac;
		}
	);

	// De-dupe identical queries, keeping best row (highest clicks/impr).
	$seen = [];
	$top = [];
	foreach ( $out as $r ) {
		$key = vt_maint_canonicalize_gsc_query( (string) ( $r['query'] ?? '' ) );
		if ( '' === $key ) {
			continue;
		}
		if ( isset( $seen[ $key ] ) ) {
			continue;
		}
		$seen[ $key ] = true;
		$top[] = $r;
		if ( count( $top ) >= $limit ) {
			break;
		}
	}

	update_option( 'vt_gsc_top_queries', $top, false );
	$log = [
		'ok'      => 1,
		'utc'     => gmdate( 'c' ),
		'count'   => count( $top ),
		'file'    => VT_MAINT_GSC_QUERIES_FILE,
		'sample'  => array_slice( $top, 0, 10 ),
	];
	$fp = vt_maint_write_log_json( 'gsc-top-queries.json', $log );

	return [
		'ok'      => 1,
		'updated' => count( $top ),
		'count'   => count( $top ),
		'log'     => $fp,
	];
}

/**
 * Resolve a term_id by (taxonomy, slug) without Polylang language filters.
 */
function vt_maint_term_id_by_slug_raw( $taxonomy, $slug ) {
	global $wpdb;
	$taxonomy = (string) $taxonomy;
	$slug     = sanitize_title( (string) $slug );
	if ( '' === $taxonomy || '' === $slug ) {
		return 0;
	}
	$term_id = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT t.term_id
			 FROM {$wpdb->terms} t
			 INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_id = t.term_id
			 WHERE tt.taxonomy = %s AND t.slug = %s
			 LIMIT 1",
			$taxonomy,
			$slug
		)
	);
	return intval( $term_id );
}

/**
 * Hololist data is English and largely language-agnostic (links, counts, avatar, summary),
 * so we sync VT meta across translations to keep all languages consistent.
 *
 * Note: We DO sync taxonomy terms here to keep collection pages functional across languages.
 * This is acceptable for now because most terms are English/neutral; we can later introduce
 * proper term translations and language-specific term mapping if needed.
 */
function vt_maint_propagate_vt_meta_to_translations( $source_id ) {
	$source_id = intval( $source_id );
	if ( $source_id <= 0 ) {
		return [ 'ok' => 0, 'updated' => 0, 'reason' => 'invalid_source' ];
	}
	if ( ! function_exists( 'pll_get_post_translations' ) ) {
		return [ 'ok' => 0, 'updated' => 0, 'reason' => 'polylang_missing' ];
	}
	$map = pll_get_post_translations( $source_id );
	if ( ! is_array( $map ) || empty( $map ) ) {
		return [ 'ok' => 1, 'updated' => 0, 'reason' => 'no_translations' ];
	}

	$updated = 0;
	foreach ( $map as $lang => $tid ) {
		$tid = intval( $tid );
		if ( $tid <= 0 || $tid === $source_id ) {
			continue;
		}
		vt_maint_copy_vt_meta( $source_id, $tid );
		vt_maint_copy_vt_terms( $source_id, $tid );
		$updated++;
	}
	return [ 'ok' => 1, 'updated' => $updated ];
}

/**
 * Sync VT meta + taxonomy terms from default-language source posts to their translations,
 * focusing on recently modified authoritative sources (tw_sheet / hololist).
 *
 * This prevents mismatches like: excerpt says "停止活動" but EN/CN pages still show "Active".
 *
 * Note: We only copy vt_* meta + taxonomy terms. We do not overwrite post content/title/excerpt,
 * so future manual translations can be applied without being clobbered.
 */
function vt_maint_sync_translation_meta_run( $batch = 40, $hours = 72, $force_id = 0 ) {
	$lock_key = 'vt_maint_sync_translation_meta_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 3600 ) ) {
		return [ 'locked' => 1 ];
	}

	try {
		if ( ! function_exists( 'pll_get_post_translations' ) || ! function_exists( 'pll_get_post_language' ) ) {
			return [ 'ok' => 0, 'error' => 'missing_polylang_api' ];
		}

		$batch = max( 5, min( 200, intval( $batch ) ) );
		$hours = max( 6, min( 24 * 30, intval( $hours ) ) );
		$force_id = intval( $force_id );

		$default = vt_maint_default_lang_slug();
		$after   = gmdate( 'Y-m-d H:i:s', time() - ( $hours * 3600 ) );

		// Fast path: force sync for a single source post ID (useful when a specific VTuber is mis-labeled across languages).
		if ( $force_id > 0 ) {
			$q = new WP_Query(
				[
					'post_type'        => 'vtuber',
					'post_status'      => 'publish',
					'suppress_filters' => true,
					'posts_per_page'   => 1,
					'post__in'         => [ $force_id ],
					'fields'           => 'ids',
					'no_found_rows'    => true,
				]
			);
		} else {
			// Cursor-based scan over all authoritative sources (don't rely on post_modified,
			// because taxonomy/meta updates do not bump modified time).
			$cursor_key = 'vt_maint_sync_translation_meta_cursor';
			$cursor = intval( get_option( $cursor_key, 0 ) );

			$q = new WP_Query(
				[
					'post_type'        => 'vtuber',
					'post_status'      => 'publish',
					'suppress_filters' => true,
					'posts_per_page'   => $batch,
					'offset'           => max( 0, $cursor ),
					'orderby'          => 'ID',
					'order'            => 'ASC',
					'meta_query'       => [
						[
							'key'     => 'vt_data_origin',
							'value'   => [ 'tw_sheet', 'hololist' ],
							'compare' => 'IN',
						],
					],
					'fields'           => 'ids',
					'no_found_rows'    => false,
				]
			);
			if ( empty( $q->posts ) && $cursor > 0 ) {
				$cursor = 0;
				$q = new WP_Query(
					[
						'post_type'        => 'vtuber',
						'post_status'      => 'publish',
						'suppress_filters' => true,
						'posts_per_page'   => $batch,
						'offset'           => 0,
						'orderby'          => 'ID',
						'order'            => 'ASC',
						'meta_query'       => [
							[
								'key'     => 'vt_data_origin',
								'value'   => [ 'tw_sheet', 'hololist' ],
								'compare' => 'IN',
							],
						],
						'fields'           => 'ids',
						'no_found_rows'    => false,
					]
				);
			}
		}

		$checked = 0;
		$groups  = 0;
		$updated = 0;
		$errors  = [];

		foreach ( (array) $q->posts as $pid ) {
			$pid = intval( $pid );
			if ( $pid <= 0 ) {
				continue;
			}

			$src_lang = (string) pll_get_post_language( $pid, 'slug' );
			if ( $src_lang === '' ) {
				continue;
			}
			if ( $src_lang !== $default ) {
				continue;
			}

			$checked++;
			$res = vt_maint_propagate_vt_meta_to_translations( $pid );
			if ( is_array( $res ) && intval( $res['ok'] ?? 0 ) === 1 ) {
				$u = intval( $res['updated'] ?? 0 );
				if ( $u > 0 ) {
					$groups++;
					$updated += $u;
				}
				update_post_meta( $pid, 'vt_translations_synced_at', time() );
			} else {
				$errors[] = [ 'id' => $pid, 'err' => (string) ( $res['reason'] ?? $res['error'] ?? 'unknown' ) ];
			}
		}

		// Cursor advance only for scan mode.
		$cursor_before = null;
		$cursor_after  = null;
		$total_found   = null;
		$processed     = count( (array) ( $q->posts ?? [] ) );
		if ( $force_id <= 0 ) {
			$cursor_key = 'vt_maint_sync_translation_meta_cursor';
			$cursor_before = intval( get_option( $cursor_key, 0 ) );
			$total_found   = intval( $q->found_posts ?? 0 );
			$next_cursor   = $cursor_before + $processed;
			if ( $processed <= 0 || ( $total_found > 0 && $next_cursor >= $total_found ) ) {
				$next_cursor = 0;
			}
			update_option( $cursor_key, intval( $next_cursor ), false );
			$cursor_after = intval( $next_cursor );
		}

		$report = [
			'utc'        => gmdate( 'c' ),
			'default'    => $default,
			'batch'      => $batch,
			'hours'      => $hours,
			'after'      => $after,
			'force_id'   => $force_id,
			'cursor_before' => $cursor_before,
			'cursor_after'  => $cursor_after,
			'total_found'   => $total_found,
			'processed'  => $processed,
			'checked'    => $checked,
			'groups'     => $groups,
			'updated'    => $updated,
			'errors'     => array_slice( $errors, 0, 40 ),
		];

		$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		@file_put_contents( $dir . 'translations-meta-sync-last.json', json_encode( $report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
		vt_maint_log( 'sync_translation_meta checked=' . $checked . ' groups=' . $groups . ' updated=' . $updated . ' errors=' . count( $errors ) );
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_portal_page_templates() {
	return [
		'vt-portal-landing.php',
		'vt-platform-index.php',
		'vt-agency-index.php',
		'vt-country-index.php',
		'vt-debut-year-index.php',
		'vt-role-index.php',
		'vt-contact.php',
	];
}

function vt_maint_ensure_page_translations_run() {
	$lock_key = 'vt_maint_ensure_page_translations_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 3600 ) ) {
		return [ 'locked' => 1 ];
	}

	try {
		if ( ! function_exists( 'pll_get_post_translations' ) || ! function_exists( 'pll_insert_post' ) || ! function_exists( 'pll_save_post_translations' ) || ! function_exists( 'pll_get_post_language' ) ) {
			vt_maint_log( 'ensure_page_translations missing polylang api' );
			return [ 'ok' => 0, 'error' => 'missing_polylang_api' ];
		}

		$targets   = array_values( array_unique( array_filter( array_map( 'sanitize_title', (array) vt_maint_target_lang_slugs() ) ) ) );
		$default   = vt_maint_default_lang_slug();
		$templates = vt_maint_portal_page_templates();
		$checked   = 0;
		$created   = 0;
		$linked    = 0;
		$landing_default_id = 0;
		$front_before = intval( get_option( 'page_on_front' ) );
		$front_after  = $front_before;
		$front_assigned = 0;
		$errors    = [];

		$q = new WP_Query(
			[
				'post_type'        => 'page',
				'post_status'      => 'publish',
				'posts_per_page'   => 120,
				'fields'           => 'ids',
				'orderby'          => 'ID',
				'order'            => 'ASC',
				'suppress_filters' => true,
				'meta_query'       => [
					[
						'key'     => '_wp_page_template',
						'value'   => $templates,
						'compare' => 'IN',
					],
				],
			]
		);

		foreach ( (array) $q->posts as $pid ) {
			$pid = intval( $pid );
			if ( $pid <= 0 ) {
				continue;
			}

			$template = (string) get_post_meta( $pid, '_wp_page_template', true );
			if ( ! in_array( $template, $templates, true ) ) {
				continue;
			}

			$src_lang = (string) pll_get_post_language( $pid, 'slug' );
			if ( '' === $src_lang ) {
				if ( function_exists( 'pll_set_post_language' ) ) {
					try {
						pll_set_post_language( $pid, $default );
						$src_lang = $default;
					} catch ( Throwable $e ) {
						$errors[] = [ 'id' => $pid, 'lang' => $default, 'err' => 'pll_set_post_language:' . $e->getMessage() ];
						continue;
					}
				} else {
					$src_lang = $default;
				}
			}

			if ( $src_lang !== $default ) {
				continue;
			}

			if ( 'vt-portal-landing.php' === $template ) {
				$landing_default_id = $pid;
			}

			$post = get_post( $pid );
			if ( ! $post ) {
				continue;
			}

			$checked++;
			$translations = pll_get_post_translations( $pid );
			if ( ! is_array( $translations ) ) {
				$translations = [];
			}
			$map = $translations;
			$map[ $src_lang ] = $pid;

			foreach ( $targets as $lang ) {
				$lang = (string) $lang;
				if ( '' === $lang || $lang === $default ) {
					continue;
				}
				if ( ! empty( $map[ $lang ] ) ) {
					continue;
				}

				try {
					$new_id = pll_insert_post(
						[
							'post_type'    => 'page',
							'post_status'  => 'publish',
							'post_title'   => (string) $post->post_title,
							'post_content' => (string) $post->post_content,
							'post_excerpt' => (string) $post->post_excerpt,
						],
						$lang
					);
				} catch ( Throwable $e ) {
					$errors[] = [ 'id' => $pid, 'lang' => $lang, 'err' => $e->getMessage() ];
					continue;
				}

				$new_id = intval( $new_id );
				if ( $new_id <= 0 ) {
					$errors[] = [ 'id' => $pid, 'lang' => $lang, 'err' => 'pll_insert_post_failed' ];
					continue;
				}

				update_post_meta( $new_id, '_wp_page_template', $template );
				$map[ $lang ] = $new_id;
				$created++;
			}

			if ( count( $map ) > count( $translations ) ) {
				try {
					pll_save_post_translations( $map );
					$linked++;
				} catch ( Throwable $e ) {
					$errors[] = [ 'id' => $pid, 'lang' => '*', 'err' => 'pll_save_post_translations:' . $e->getMessage() ];
				}
			}
		}

		// Force portal landing as the multilingual front-page anchor.
		// This keeps /en/, /cn/, /ko/, /es/, /hi/ bound to landing translations
		// instead of drifting to legacy translated pages.
		if ( $landing_default_id > 0 ) {
			update_option( 'show_on_front', 'page' );
			if ( $front_before !== $landing_default_id ) {
				update_option( 'page_on_front', $landing_default_id );
				$front_assigned = 1;
			}
			$front_after = intval( get_option( 'page_on_front' ) );
		}

		$report = [
			'utc'          => gmdate( 'c' ),
			'default_lang' => $default,
			'target_langs' => $targets,
			'templates'    => $templates,
			'checked'      => $checked,
			'created'      => $created,
			'linked'       => $linked,
			'front_before' => $front_before,
			'front_after'  => $front_after,
			'front_assigned' => $front_assigned,
			'landing_default_id' => $landing_default_id,
			'errors'       => array_slice( $errors, 0, 40 ),
		];

		$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		@file_put_contents( $dir . 'page-translations-ensure-last.json', json_encode( $report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
		vt_maint_log( 'ensure_page_translations checked=' . $checked . ' created=' . $created . ' linked=' . $linked . ' errors=' . count( $errors ) );
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_ensure_translations_run( $batch = 20 ) {
	$lock_key = 'vt_maint_ensure_translations_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 3600 ) ) {
		return [ 'locked' => 1 ];
	}

	try {
		if ( ! function_exists( 'pll_get_post_translations' ) || ! function_exists( 'pll_insert_post' ) || ! function_exists( 'pll_save_post_translations' ) || ! function_exists( 'pll_get_post_language' ) ) {
			vt_maint_log( 'ensure_translations missing polylang api' );
			return [ 'ok' => 0, 'error' => 'missing_polylang_api' ];
		}

		$batch   = max( 5, min( 120, intval( $batch ) ) );
		$targets = array_values( array_unique( array_filter( array_map( 'sanitize_title', (array) vt_maint_target_lang_slugs() ) ) ) );
		$default = vt_maint_default_lang_slug();
		$created = 0;
		$linked  = 0;
		$checked = 0;
		$errors  = [];
		$cursor_key = 'vt_maint_ensure_translations_cursor';
		$cursor = intval( get_option( $cursor_key, 0 ) );

		$q = new WP_Query(
			[
				'post_type'      => 'vtuber',
				'post_status'    => 'publish',
				// Avoid Polylang/frontend language filters so we can pick source posts explicitly.
				'suppress_filters' => true,
				'posts_per_page' => $batch,
				'offset'         => max( 0, $cursor ),
				'orderby'        => 'ID',
				'order'          => 'ASC',
				'no_found_rows'  => false,
				'fields'         => 'ids',
			]
		);
		if ( empty( $q->posts ) && $cursor > 0 ) {
			$cursor = 0;
			$q = new WP_Query(
				[
					'post_type'      => 'vtuber',
					'post_status'    => 'publish',
					'suppress_filters' => true,
					'posts_per_page' => $batch,
					'offset'         => 0,
					'orderby'        => 'ID',
					'order'          => 'ASC',
					'no_found_rows'  => false,
					'fields'         => 'ids',
				]
			);
		}

		foreach ( (array) $q->posts as $pid ) {
			$pid = intval( $pid );
			if ( $pid <= 0 ) {
				continue;
			}

			// Use only default-language posts as the translation sources.
			$src_lang = (string) pll_get_post_language( $pid, 'slug' );
			if ( $src_lang === '' ) {
				// Some legacy posts may have no language assigned. Assign default to make routing deterministic.
				if ( function_exists( 'pll_set_post_language' ) ) {
					try {
						pll_set_post_language( $pid, $default );
						$src_lang = $default;
					} catch ( Throwable $e ) {
						$errors[] = [ 'id' => $pid, 'lang' => $default, 'err' => 'pll_set_post_language:' . $e->getMessage() ];
						continue;
					}
				} else {
					$src_lang = $default;
				}
			}
			if ( $src_lang !== $default ) {
				continue;
			}

			$checked++;

			$translations = pll_get_post_translations( $pid );
			if ( ! is_array( $translations ) ) {
				$translations = [];
			}

			$map = $translations;
			$map[ $src_lang ] = $pid; // Ensure source is present.

			$post = get_post( $pid );
			if ( ! $post ) {
				continue;
			}

			$origin = (string) get_post_meta( $pid, 'vt_data_origin', true );

			foreach ( $targets as $lang ) {
				$lang = (string) $lang;
				if ( $lang === '' ) {
					continue;
				}
				if ( $lang === $default ) {
					continue;
				}
				if ( isset( $map[ $lang ] ) && intval( $map[ $lang ] ) > 0 ) {
					continue;
				}

				$new_id = 0;
				try {
					$new_id = pll_insert_post(
						[
							'post_type'    => 'vtuber',
							'post_status'  => 'publish',
							'post_title'   => (string) $post->post_title,
							'post_name'    => (string) $post->post_name,
							'post_content' => (string) $post->post_content,
							'post_excerpt' => (string) $post->post_excerpt,
						],
						$lang
					);
				} catch ( Throwable $e ) {
					$errors[] = [ 'id' => $pid, 'lang' => $lang, 'err' => $e->getMessage() ];
					continue;
				}

				$new_id = intval( $new_id );
				if ( $new_id <= 0 ) {
					$errors[] = [ 'id' => $pid, 'lang' => $lang, 'err' => 'pll_insert_post_failed' ];
					continue;
				}

				vt_maint_copy_vt_meta( $pid, $new_id );
				vt_maint_copy_vt_terms( $pid, $new_id );

				$map[ $lang ] = $new_id;
				$created++;
			}

			// Keep authoritative source meta consistent across all translations.
			// - hololist: global data is English and language-agnostic.
			// - tw_sheet: Taiwan VTuber source is authoritative; translations should not drift.
			if ( in_array( $origin, [ 'hololist', 'tw_sheet' ], true ) && count( $map ) >= 2 ) {
				vt_maint_propagate_vt_meta_to_translations( $pid );
			}

			// Link translations if we added any.
			if ( count( $map ) > count( $translations ) ) {
				try {
					pll_save_post_translations( $map );
					$linked++;
				} catch ( Throwable $e ) {
					$errors[] = [ 'id' => $pid, 'lang' => '*', 'err' => 'pll_save_post_translations:' . $e->getMessage() ];
				}
			}
		}
		$processed_count = count( (array) $q->posts );
		$total_found = intval( $q->found_posts );
		$next_cursor = $cursor + $processed_count;
		if ( $processed_count <= 0 || $next_cursor >= $total_found ) {
			$next_cursor = 0;
		}
		update_option( $cursor_key, intval( $next_cursor ), false );

		$report = [
			'utc'          => gmdate( 'c' ),
			'default_lang' => $default,
			'cursor_before'=> intval( $cursor ),
			'cursor_after' => intval( $next_cursor ),
			'batch'        => intval( $batch ),
			'total_found'  => intval( $total_found ),
			'processed'    => intval( $processed_count ),
			'checked'      => $checked,
			'created'      => $created,
			'linked'       => $linked,
			'errors'       => array_slice( $errors, 0, 40 ),
			'target_langs' => $targets,
		];

		$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		@file_put_contents( $dir . 'translations-ensure-last.json', json_encode( $report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );

		vt_maint_log( 'ensure_translations checked=' . $checked . ' created=' . $created . ' linked=' . $linked . ' errors=' . count( $errors ) );
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_fillthumbs_run() {
	$lock_key = 'vt_maint_fillthumbs_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 3600 ) ) {
		return;
	}

	try {
		$filled   = 0;
		$skipped  = 0;
		$failed   = 0;
		$checked  = 0;
		$fail_samples = [];
		$api_key  = vt_maint_sheet_api_key();
		$batch    = 120;
		vt_maint_require_media_api();

		// Cursor scan so older posts eventually get processed too (not only recently modified).
		// This avoids a "forever incomplete" avatar state on large datasets.
		$cursor_key = 'vt_fillthumbs_cursor_id';
		$cursor     = intval( get_option( $cursor_key, 0 ) );

		$candidate_ids = [];
		$missing_file  = WP_CONTENT_DIR . '/uploads/vt-logs/sheet-sync-missing-avatar.json';
		if ( file_exists( $missing_file ) ) {
			$raw = @file_get_contents( $missing_file );
			$arr = json_decode( (string) $raw, true );
			if ( is_array( $arr ) ) {
				foreach ( $arr as $it ) {
					if ( ! is_array( $it ) ) {
						continue;
					}
					$pid = intval( $it['id'] ?? 0 );
					if ( $pid <= 0 ) {
						continue;
					}
					$has_url = false;
					foreach ( [ 'youtube', 'twitch', 'twitter', 'facebook' ] as $k ) {
						if ( '' !== trim( (string) ( $it[ $k ] ?? '' ) ) ) {
							$has_url = true;
							break;
						}
					}
					if ( $has_url ) {
						$candidate_ids[] = $pid;
					}
					if ( count( $candidate_ids ) >= $batch ) {
						break;
					}
				}
			}
		}
		$diag_file = WP_CONTENT_DIR . '/uploads/vt-logs/avatar-diagnose.json';
		if ( file_exists( $diag_file ) && count( $candidate_ids ) < ( $batch * 3 ) ) {
			$raw = @file_get_contents( $diag_file );
			$arr = json_decode( (string) $raw, true );
			$items = isset( $arr['items'] ) && is_array( $arr['items'] ) ? $arr['items'] : [];
			foreach ( $items as $it ) {
				if ( ! is_array( $it ) ) {
					continue;
				}
				$pid = intval( $it['id'] ?? 0 );
				if ( $pid <= 0 ) {
					continue;
				}
				$reasons = isset( $it['reasons'] ) && is_array( $it['reasons'] ) ? $it['reasons'] : [];
				$is_fixable = in_array( 'has_social_url_but_unresolved', $reasons, true ) || in_array( 'tiny_file', $reasons, true ) || in_array( 'small_dimensions', $reasons, true ) || in_array( 'no_thumbnail', $reasons, true );
				if ( $is_fixable ) {
					$candidate_ids[] = $pid;
				}
				if ( count( $candidate_ids ) >= ( $batch * 3 ) ) {
					break;
				}
			}
		}
		$candidate_ids = array_values( array_unique( array_map( 'intval', $candidate_ids ) ) );

		$pool_ids = [];

		// Append some IDs from a stable cursor scan (ID ASC), so every run advances.
		// Use direct SQL to filter by ID efficiently.
		global $wpdb;
		$cursor_ids = [];
		$scan_limit = 520;
		if ( $wpdb ) {
			$cursor_ids = $wpdb->get_col(
				$wpdb->prepare(
					"SELECT ID FROM {$wpdb->posts} WHERE post_type=%s AND post_status=%s AND ID>%d ORDER BY ID ASC LIMIT %d",
					'vtuber',
					'publish',
					$cursor,
					$scan_limit
				)
			);
			if ( empty( $cursor_ids ) && $cursor > 0 ) {
				// Wrap-around once we hit the end.
				$cursor = 0;
				$cursor_ids = $wpdb->get_col(
					$wpdb->prepare(
						"SELECT ID FROM {$wpdb->posts} WHERE post_type=%s AND post_status=%s AND ID>%d ORDER BY ID ASC LIMIT %d",
						'vtuber',
						'publish',
						$cursor,
						$scan_limit
					)
				);
			}
		}

		// Interleave candidate IDs with cursor IDs so the cursor always progresses,
		// even when candidates contain lots of unresolved entries.
		$cand = $candidate_ids;
		$cur  = array_values( array_map( 'intval', (array) $cursor_ids ) );
		while ( count( $pool_ids ) < 800 && ( ! empty( $cand ) || ! empty( $cur ) ) ) {
			for ( $i = 0; $i < 20 && ! empty( $cand ) && count( $pool_ids ) < 800; $i++ ) {
				$pool_ids[] = intval( array_shift( $cand ) );
			}
			for ( $i = 0; $i < 60 && ! empty( $cur ) && count( $pool_ids ) < 800; $i++ ) {
				$pool_ids[] = intval( array_shift( $cur ) );
			}
		}
		$pool_ids = array_values( array_unique( array_filter( array_map( 'intval', $pool_ids ) ) ) );

		$q_args = [
			'post_type'      => 'vtuber',
			'post_status'    => 'publish',
			'posts_per_page' => ! empty( $pool_ids ) ? count( $pool_ids ) : 260,
			'orderby'        => ! empty( $pool_ids ) ? 'post__in' : 'modified',
			'order'          => 'DESC',
			'fields'         => 'ids',
			'no_found_rows'  => false,
		];
		// Important: do not pass post__in when the pool is empty.
		// In WP_Query, post__in = [] returns zero posts and blocks the fallback scan.
		if ( ! empty( $pool_ids ) ) {
			$q_args['post__in'] = $pool_ids;
		}
		$q = new WP_Query( $q_args );

		if ( $q->have_posts() ) {
			$cursor_set = [];
			foreach ( (array) $cursor_ids as $id ) {
				$cursor_set[ intval( $id ) ] = 1;
			}
			$last_cursor_seen = 0;
			$attempts = 0;
			$social_updates = 0;
			foreach ( $q->posts as $pid ) {
				$checked++;
				$need_thumb  = vt_maint_post_needs_thumbnail( $pid );
				$need_social = vt_maint_post_needs_social_enrich( $pid );
				if ( ! $need_thumb && ! $need_social ) {
					$skipped++;
					continue;
				}

				$res = vt_maint_try_resolve_avatar_for_post( intval( $pid ), $api_key );
				if ( ! empty( $res['set'] ) ) {
					$filled++;
					$attempts++;
					$social_updates += intval( $res['social_updated'] ?? 0 );
				} elseif ( ! empty( $res['social_updated'] ) ) {
					// No thumbnail change, but metrics/summary was updated.
					$social_updates += intval( $res['social_updated'] ?? 0 );
					$attempts++;
				} elseif ( 'already_has_thumbnail' === (string) ( $res['reason'] ?? '' ) || empty( $res['tried'] ) ) {
					$skipped++;
				} else {
					$failed++;
					$attempts++;
					if ( count( $fail_samples ) < 6 ) {
						$fail_samples[] = [
							'id'     => intval( $pid ),
							'reason' => (string) ( $res['reason'] ?? '' ),
							'tried'  => isset( $res['tried'] ) && is_array( $res['tried'] ) ? array_values( $res['tried'] ) : [],
						];
					}
				}

				if ( isset( $cursor_set[ intval( $pid ) ] ) ) {
					$last_cursor_seen = max( $last_cursor_seen, intval( $pid ) );
				}

				// Limit expensive resolve attempts per run (network calls). Cursor scanning still progresses.
				if ( $attempts >= $batch ) {
					break;
				}
			}
			wp_reset_postdata();

			if ( $last_cursor_seen > 0 ) {
				update_option( $cursor_key, intval( $last_cursor_seen ), false );
			}
		}

		vt_maint_log(
			"fillthumbs checked=$checked filled=$filled skip=$skipped fail=$failed pool=" . intval( $q->found_posts ) .
			' prioritized=' . count( $candidate_ids ) .
			' social_updates=' . intval( $social_updates ) .
			' cursor=' . intval( get_option( $cursor_key, 0 ) ) .
			' sample=' . wp_json_encode( $fail_samples, JSON_UNESCAPED_UNICODE )
		);
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_fill_metrics_run( $batch = 120 ) {
	$lock_key = 'vt_maint_fill_metrics_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 3600 ) ) {
		return [ 'locked' => 1 ];
	}

	try {
		global $wpdb;
		if ( ! $wpdb ) {
			return [ 'ok' => 0, 'error' => 'wpdb_missing' ];
		}

		$batch    = max( 20, min( 400, intval( $batch ) ) );
		$scan_cap = max( $batch * 3, 240 );
		$api_key  = vt_maint_sheet_api_key();
		$cursor_key = 'vt_fill_metrics_cursor_id';
		$cursor_before = max( 0, intval( get_option( $cursor_key, 0 ) ) );
		$cursor = $cursor_before;

		$posts = $wpdb->posts;
		$pm    = $wpdb->postmeta;

		$fetch_ids = function( $from_id ) use ( $wpdb, $posts, $pm, $scan_cap ) {
			$sql = $wpdb->prepare(
				"
				SELECT p.ID
				FROM {$posts} p
				LEFT JOIN {$pm} yurl ON yurl.post_id = p.ID AND yurl.meta_key = 'vt_youtube_url'
				LEFT JOIN {$pm} ysub ON ysub.post_id = p.ID AND ysub.meta_key = 'vt_youtube_subs'
				LEFT JOIN {$pm} yna ON yna.post_id = p.ID AND yna.meta_key = 'vt_youtube_subs_unavailable'
				LEFT JOIN {$pm} twurl ON twurl.post_id = p.ID AND twurl.meta_key = 'vt_twitch_url'
				LEFT JOIN {$pm} twfol ON twfol.post_id = p.ID AND twfol.meta_key = 'vt_twitch_followers'
				LEFT JOIN {$pm} tna ON tna.post_id = p.ID AND tna.meta_key = 'vt_twitch_followers_unavailable'
				LEFT JOIN {$pm} tns ON tns.post_id = p.ID AND tns.meta_key = 'vt_twitch_followers_status'
				WHERE p.post_type = 'vtuber'
				  AND p.post_status = 'publish'
				  AND p.ID > %d
				  AND (
					( COALESCE(TRIM(yurl.meta_value), '') <> '' AND CAST(COALESCE(ysub.meta_value, '0') AS UNSIGNED) <= 0 AND COALESCE(yna.meta_value, '0') <> '1' )
					OR
					( COALESCE(TRIM(twurl.meta_value), '') <> '' AND CAST(COALESCE(twfol.meta_value, '0') AS UNSIGNED) <= 0 AND COALESCE(tna.meta_value, '0') <> '1' AND COALESCE(tns.meta_value, '') <> 'ok_zero' )
				  )
				ORDER BY p.ID ASC
				LIMIT %d
				",
				intval( $from_id ),
				intval( $scan_cap )
			);
			$ids = $wpdb->get_col( $sql );
			return array_values( array_filter( array_map( 'intval', (array) $ids ) ) );
		};

		$ids = $fetch_ids( $cursor );
		if ( empty( $ids ) && $cursor > 0 ) {
			$cursor = 0;
			$ids = $fetch_ids( 0 );
		}

		$checked = 0;
		$updated_yt = 0;
		$updated_tw = 0;
		$social_updates = 0;
		$nohit = 0;
		$items = [];
		$debug_attempts = [];
		$last_seen_id = 0;

		foreach ( $ids as $pid ) {
			$pid = intval( $pid );
			if ( $pid <= 0 ) {
				continue;
			}
			$checked++;
			$last_seen_id = max( $last_seen_id, $pid );

			$before_yt = intval( get_post_meta( $pid, 'vt_youtube_subs', true ) );
			$before_tw = intval( get_post_meta( $pid, 'vt_twitch_followers', true ) );

			$res = vt_maint_try_resolve_avatar_for_post( $pid, $api_key );

			$after_yt = intval( get_post_meta( $pid, 'vt_youtube_subs', true ) );
			$after_tw = intval( get_post_meta( $pid, 'vt_twitch_followers', true ) );
			$delta_social = intval( $res['social_updated'] ?? 0 );
			if ( $delta_social > 0 ) {
				$social_updates += $delta_social;
			}

			if ( $before_yt <= 0 && $after_yt > 0 ) {
				$updated_yt++;
			}
			if ( $before_tw <= 0 && $after_tw > 0 ) {
				$updated_tw++;
			}
			if ( $before_yt <= 0 && $after_yt <= 0 && $before_tw <= 0 && $after_tw <= 0 ) {
				$nohit++;
			}

			if ( count( $items ) < 60 && ( $before_yt !== $after_yt || $before_tw !== $after_tw ) ) {
				$items[] = [
					'id'        => $pid,
					'title'     => (string) get_the_title( $pid ),
					'yt_before' => $before_yt,
					'yt_after'  => $after_yt,
					'tw_before' => $before_tw,
					'tw_after'  => $after_tw,
				];
			}
			if ( count( $debug_attempts ) < 80 ) {
				$debug_attempts[] = [
					'id'        => $pid,
					'title'     => (string) get_the_title( $pid ),
					'yt_url'    => vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_youtube_url', true ) ),
					'twitch_url'=> vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_twitch_url', true ) ),
					'yt_before' => $before_yt,
					'yt_after'  => $after_yt,
					'tw_before' => $before_tw,
					'tw_after'  => $after_tw,
					'reason'    => (string) ( $res['reason'] ?? '' ),
					'tried'     => isset( $res['tried'] ) && is_array( $res['tried'] ) ? array_values( $res['tried'] ) : [],
				];
			}

			if ( $checked >= $batch ) {
				break;
			}
		}

		$cursor_after = 0;
		if ( ! empty( $ids ) && $last_seen_id > 0 ) {
			$cursor_after = intval( $last_seen_id );
			update_option( $cursor_key, $cursor_after, false );
		} else {
			update_option( $cursor_key, 0, false );
		}

		$report = [
			'ok'             => 1,
			'utc'            => gmdate( 'c' ),
			'batch'          => $batch,
			'checked'        => $checked,
			'updated_yt'     => $updated_yt,
			'updated_twitch' => $updated_tw,
			'social_updates' => $social_updates,
			'nohit'          => $nohit,
			'cursor_before'  => $cursor_before,
			'cursor_after'   => $cursor_after,
			'items'          => $items,
			'debug_attempts' => $debug_attempts,
		];
		vt_maint_write_log_json( 'metrics-fill-last.json', $report );
		vt_maint_log(
			'fill_metrics checked=' . intval( $checked ) .
			' yt=' . intval( $updated_yt ) .
			' twitch=' . intval( $updated_tw ) .
			' social_updates=' . intval( $social_updates ) .
			' nohit=' . intval( $nohit ) .
			' cursor=' . intval( $cursor_after )
		);
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_fix_tiny_thumb_fallback_run( $batch = 120 ) {
	$lock_key = 'vt_maint_fix_tiny_thumb_fallback_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 1800 ) ) {
		return [ 'locked' => 1 ];
	}
	try {
		$batch = max( 20, min( 500, intval( $batch ) ) );
		$checked = 0;
		$fixed = 0;
		$skipped = 0;
		$items = [];

		$q = new WP_Query(
			[
				'post_type'      => 'vtuber',
				'post_status'    => 'publish',
				'posts_per_page' => $batch * 5,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'fields'         => 'ids',
				'no_found_rows'  => true,
			]
		);
		if ( $q->have_posts() ) {
			foreach ( (array) $q->posts as $pid ) {
				$pid = intval( $pid );
				if ( $pid <= 0 ) {
					continue;
				}
				$checked++;
				if ( $checked > $batch * 3 ) {
					break;
				}

				$thumb_id = intval( get_post_thumbnail_id( $pid ) );
				if ( $thumb_id <= 0 ) {
					$skipped++;
					continue;
				}
				$file = get_attached_file( $thumb_id );
				$is_tiny = false;
				$is_small = false;
				if ( is_string( $file ) && file_exists( $file ) ) {
					$fs = intval( @filesize( $file ) );
					if ( $fs > 0 && $fs < 4500 ) {
						$is_tiny = true;
					}
					$sz = @getimagesize( $file );
					$w = intval( $sz[0] ?? 0 );
					$h = intval( $sz[1] ?? 0 );
					if ( $w > 0 && $h > 0 && ( $w < 120 || $h < 120 ) ) {
						$is_small = true;
					}
				}
				if ( ! $is_tiny && ! $is_small ) {
					$skipped++;
					continue;
				}

				$candidate = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_thumb_source_url', true ) );
				if ( '' === $candidate || vt_maint_is_placeholder_avatar_url( $candidate ) ) {
					$candidate = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_thumb_url', true ) );
				}
				if ( '' === $candidate || vt_maint_is_placeholder_avatar_url( $candidate ) ) {
					$skipped++;
					continue;
				}

				// If current featured image is low quality but we have a valid remote source,
				// remove featured thumbnail so vt_effective_thumb_url can fall back to the source meta.
				delete_post_thumbnail( $pid );
				update_post_meta( $pid, 'vt_thumb_url', $candidate );
				update_post_meta( $pid, 'vt_thumb_source_url', $candidate );
				update_post_meta( $pid, 'vt_thumb_refreshed_utc', gmdate( 'c' ) );
				$fixed++;
				if ( count( $items ) < 80 ) {
					$items[] = [
						'id'       => $pid,
						'title'    => (string) get_the_title( $pid ),
						'candidate'=> $candidate,
						'tiny'     => $is_tiny ? 1 : 0,
						'small'    => $is_small ? 1 : 0,
					];
				}
				if ( $fixed >= $batch ) {
					break;
				}
			}
			wp_reset_postdata();
		}

		$report = [
			'ok'      => 1,
			'utc'     => gmdate( 'c' ),
			'batch'   => $batch,
			'checked' => $checked,
			'fixed'   => $fixed,
			'skipped' => $skipped,
			'items'   => $items,
		];
		vt_maint_write_log_json( 'tiny-thumb-fallback-last.json', $report );
		vt_maint_log( 'tiny_thumb_fallback checked=' . intval( $checked ) . ' fixed=' . intval( $fixed ) . ' skipped=' . intval( $skipped ) );
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_enrich_social_bio_run( $batch = 60, $force = 0 ) {
	$lock_key = 'vt_maint_enrich_social_bio_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 3600 ) ) {
		return [ 'locked' => 1 ];
	}
	try {
		$batch = max( 5, min( 120, intval( $batch ) ) );
		$force = intval( $force ) ? 1 : 0;
		$api_key = vt_maint_sheet_api_key();

		$checked = 0;
		$updated = 0;
		$skipped = 0;
		$nohit   = 0;
		$items   = [];

		$q = new WP_Query(
			[
				'post_type'      => 'vtuber',
				'post_status'    => 'publish',
				'posts_per_page' => $batch * 4,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'fields'         => 'ids',
				'no_found_rows'  => true,
			]
		);
		if ( $q->have_posts() ) {
			foreach ( (array) $q->posts as $pid ) {
				$pid = intval( $pid );
				if ( $pid <= 0 ) {
					continue;
				}
				$checked++;
				if ( $updated >= $batch ) {
					break;
				}
				if ( ! vt_maint_post_has_any_social_url( $pid ) ) {
					$skipped++;
					continue;
				}
				$current = (string) get_post_meta( $pid, 'vt_summary', true );
				if ( ! $force && ! vt_maint_summary_needs_enrich( $current ) ) {
					$skipped++;
					continue;
				}
				$best = vt_maint_pick_best_social_summary( $pid, $api_key );
				$sum  = trim( (string) ( $best['summary'] ?? '' ) );
				if ( '' === $sum ) {
					$nohit++;
					continue;
				}
				update_post_meta( $pid, 'vt_summary', $sum );
				update_post_meta( $pid, 'vt_summary_source', (string) ( $best['source'] ?? 'social_meta' ) );
				update_post_meta( $pid, 'vt_summary_refreshed_utc', gmdate( 'c' ) );
				$updated++;
				if ( count( $items ) < 30 ) {
					$items[] = [
						'id'     => $pid,
						'title'  => (string) get_the_title( $pid ),
						'source' => (string) ( $best['source'] ?? '' ),
					];
				}
			}
			wp_reset_postdata();
		}
		$report = [
			'ok'      => 1,
			'utc'     => gmdate( 'c' ),
			'batch'   => $batch,
			'force'   => $force,
			'checked' => $checked,
			'updated' => $updated,
			'skipped' => $skipped,
			'nohit'   => $nohit,
			'items'   => $items,
		];
		vt_maint_write_log_json( 'social-bio-last.json', $report );
		vt_maint_log( 'social_bio checked=' . intval( $checked ) . ' updated=' . intval( $updated ) . ' skipped=' . intval( $skipped ) . ' nohit=' . intval( $nohit ) );
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_content_needs_enrich( $content, $min_len = 180 ) {
	$txt = trim( wp_strip_all_tags( html_entity_decode( (string) $content, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ) );
	$txt = trim( preg_replace( '/\s+/u', ' ', $txt ) );
	if ( '' === $txt ) {
		return true;
	}
	$len = function_exists( 'mb_strlen' ) ? intval( mb_strlen( $txt, 'UTF-8' ) ) : strlen( $txt );
	if ( $len < max( 60, intval( $min_len ) ) ) {
		return true;
	}
	$bad_markers = [
		'資料更新中',
		'暂无',
		'暫無',
		'tbd',
		'coming soon',
		'no description',
		'description unavailable',
	];
	$lower = vt_maint_lower( $txt );
	foreach ( $bad_markers as $m ) {
		$m = trim( (string) $m );
		if ( '' !== $m && false !== strpos( $lower, vt_maint_lower( $m ) ) ) {
			return true;
		}
	}
	return false;
}

function vt_maint_collect_intro_reference_links( $post_id ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return [];
	}
	$candidates = [
		'官方網站'   => (string) get_post_meta( $post_id, 'vt_official_url', true ),
		'YouTube'   => (string) get_post_meta( $post_id, 'vt_youtube_url', true ),
		'Twitch'    => (string) get_post_meta( $post_id, 'vt_twitch_url', true ),
		'X / Twitter' => (string) get_post_meta( $post_id, 'vt_twitter_url', true ),
		'Facebook'  => (string) get_post_meta( $post_id, 'vt_facebook_url', true ),
		'Bluesky'   => (string) get_post_meta( $post_id, 'vt_bluesky_url', true ),
		'萌娘百科'   => (string) get_post_meta( $post_id, 'vt_moegirl_url', true ),
		'HoloList'  => (string) get_post_meta( $post_id, 'vt_hololist_url', true ),
		'來源頁面'    => (string) get_post_meta( $post_id, 'vt_source_url', true ),
	];

	$out  = [];
	$seen = [];
	foreach ( $candidates as $label => $url ) {
		$u = vt_maint_clean_url( (string) $url );
		if ( '' === $u ) {
			continue;
		}
		$key = md5( vt_maint_lower( $u ) );
		if ( isset( $seen[ $key ] ) ) {
			continue;
		}
		$seen[ $key ] = 1;
		$out[] = [
			'label' => (string) $label,
			'url'   => $u,
		];
		if ( count( $out ) >= 6 ) {
			break;
		}
	}
	return $out;
}

function vt_maint_build_full_intro_html( $post_id ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return '';
	}
	$name = trim( (string) get_post_meta( $post_id, 'vt_display_name', true ) );
	if ( '' === $name ) {
		$name = trim( (string) get_the_title( $post_id ) );
	}
	$summary = trim( wp_strip_all_tags( (string) get_post_meta( $post_id, 'vt_summary', true ) ) );
	$summary = trim( preg_replace( '/\s+/u', ' ', $summary ) );
	if ( '' === $summary ) {
		$summary = trim( wp_strip_all_tags( (string) get_post_field( 'post_excerpt', $post_id ) ) );
		$summary = trim( preg_replace( '/\s+/u', ' ', $summary ) );
	}
	$note = trim( wp_strip_all_tags( (string) get_post_meta( $post_id, 'vt_sheet_note', true ) ) );
	$note = trim( preg_replace( '/\s+/u', ' ', $note ) );
	$affiliation = trim( wp_strip_all_tags( (string) get_post_meta( $post_id, 'vt_affiliation', true ) ) );
	$debut = trim( (string) get_post_meta( $post_id, 'vt_debut_date', true ) );
	$lifecycle = trim( (string) get_post_meta( $post_id, 'vt_lifecycle_status', true ) );

	$status_map = [
		'active'       => '活動中',
		'hiatus'       => '休止中',
		'graduated'    => '畢業 / 引退',
		'reincarnated' => '轉生 / 前世',
	];
	$status_label = isset( $status_map[ $lifecycle ] ) ? $status_map[ $lifecycle ] : '';

	$facts = [];
	if ( '' !== $affiliation ) {
		$facts[] = '<li><strong>所屬：</strong>' . esc_html( $affiliation ) . '</li>';
	}
	if ( '' !== $debut ) {
		$facts[] = '<li><strong>出道：</strong>' . esc_html( $debut ) . '</li>';
	}
	if ( '' !== $status_label ) {
		$facts[] = '<li><strong>狀態：</strong>' . esc_html( $status_label ) . '</li>';
	}

	$links = vt_maint_collect_intro_reference_links( $post_id );
	if ( '' === $summary && '' === $note && ! empty( $links ) ) {
		$summary = trim( $name ) . ' 的完整介紹資料整理中，先提供公開社群與來源連結。';
	}
	if ( '' === $summary && '' === $note ) {
		$summary = trim( $name ) . ' 的公開資料仍在整理中，後續將持續補充完整介紹。';
	}
	$link_items = [];
	foreach ( $links as $it ) {
		$label = esc_html( (string) ( $it['label'] ?? '來源' ) );
		$url   = esc_url( (string) ( $it['url'] ?? '' ) );
		if ( '' === $url ) {
			continue;
		}
		$link_items[] = '<li><a href="' . $url . '" target="_blank" rel="noopener nofollow">' . $label . '</a></li>';
	}

	$html = '<div class="vt-auto-intro" data-vt-auto="1">';
	if ( '' !== $summary ) {
		$html .= '<p>' . esc_html( $summary ) . '</p>';
	}
	if ( '' !== $note && vt_maint_lower( $note ) !== vt_maint_lower( $summary ) ) {
		$html .= '<p><strong>補充資訊：</strong>' . esc_html( vt_maint_mb_substr( $note, 420 ) ) . '</p>';
	}
	if ( ! empty( $facts ) ) {
		$html .= '<h3>基本資訊</h3><ul class="vt-auto-facts">' . implode( '', $facts ) . '</ul>';
	}
	if ( ! empty( $link_items ) ) {
		$html .= '<h3>參考來源</h3><ul class="vt-auto-sources">' . implode( '', $link_items ) . '</ul>';
	}
	$html .= '</div>';

	return trim( $html );
}

function vt_maint_enrich_full_intro_run( $batch = 40, $force = 0, $min_len = 180, $origin = '' ) {
	$lock_key = 'vt_maint_enrich_full_intro_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 3600 ) ) {
		return [ 'locked' => 1 ];
	}
	try {
		global $wpdb;
		$batch   = max( 5, min( 120, intval( $batch ) ) );
		$force   = intval( $force ) ? 1 : 0;
		$min_len = max( 80, min( 600, intval( $min_len ) ) );
		$pool    = max( $batch * 8, 120 );
		$origin  = sanitize_key( (string) $origin );
		if ( 'all' === $origin ) {
			$origin = '';
		}
		$cursor_key = 'vt_maint_full_intro_cursor';
		$cursor_from = intval( get_option( $cursor_key, 0 ) );
		$cursor_to   = $cursor_from;
		$wrapped     = 0;

		$checked   = 0;
		$updated   = 0;
		$skipped   = 0;
		$no_source = 0;
		$errors    = 0;
		$items     = [];

		$fetch_ids = static function ( $from_id, $limit ) use ( $wpdb, $origin ) {
			$from_id = intval( $from_id );
			$limit   = max( 1, intval( $limit ) );
			$sql = "SELECT p.ID FROM {$wpdb->posts} p
				WHERE p.post_type='vtuber'
				  AND p.post_status='publish'
				  AND p.ID > %d";
			$args = [ $from_id ];
			if ( '' !== $origin ) {
				$sql .= " AND EXISTS (
					SELECT 1 FROM {$wpdb->postmeta} mo
					WHERE mo.post_id = p.ID
					  AND mo.meta_key = 'vt_data_origin'
					  AND mo.meta_value = %s
				)";
				$args[] = $origin;
			}
			$sql .= ' ORDER BY p.ID ASC LIMIT %d';
			$args[] = $limit;
			return $wpdb->get_col( $wpdb->prepare( $sql, ...$args ) );
		};

		$ids = $fetch_ids( $cursor_from, $pool );
		if ( empty( $ids ) && $cursor_from > 0 ) {
			$wrapped = 1;
			$cursor_from = 0;
			$ids = $fetch_ids( 0, $pool );
		}

		if ( ! empty( $ids ) ) {
			foreach ( (array) $ids as $pid ) {
				$pid = intval( $pid );
				if ( $pid <= 0 ) {
					continue;
				}
				if ( $pid > $cursor_to ) {
					$cursor_to = $pid;
				}
				$checked++;
				if ( $updated >= $batch ) {
					break;
				}

				$current = (string) get_post_field( 'post_content', $pid );
				if ( ! $force && ! vt_maint_content_needs_enrich( $current, $min_len ) ) {
					$skipped++;
					continue;
				}

				$html = vt_maint_build_full_intro_html( $pid );
				if ( '' === trim( $html ) ) {
					$no_source++;
					continue;
				}

				$current_plain = trim( wp_strip_all_tags( (string) $current ) );
				$new_plain     = trim( wp_strip_all_tags( (string) $html ) );
				if ( ! $force && '' !== $current_plain && $current_plain === $new_plain ) {
					$skipped++;
					continue;
				}

				$res = wp_update_post(
					[
						'ID'           => $pid,
						'post_content' => $html,
					],
					true
				);
				if ( is_wp_error( $res ) ) {
					$errors++;
					continue;
				}

				update_post_meta( $pid, 'vt_intro_source', 'maint_auto' );
				update_post_meta( $pid, 'vt_intro_refreshed_utc', gmdate( 'c' ) );
				$updated++;
				if ( count( $items ) < 40 ) {
					$items[] = [
						'id'    => $pid,
						'title' => (string) get_the_title( $pid ),
					];
				}
			}
		}
		update_option( $cursor_key, intval( $cursor_to ), false );

		$report = [
			'ok'        => 1,
			'utc'       => gmdate( 'c' ),
			'batch'     => $batch,
			'force'     => $force,
			'min_len'   => $min_len,
			'origin_filter' => ( '' === $origin ? 'all' : $origin ),
			'checked'   => $checked,
			'updated'   => $updated,
			'skipped'   => $skipped,
			'no_source' => $no_source,
			'errors'    => $errors,
			'cursor_from' => $cursor_from,
			'cursor_to'   => $cursor_to,
			'wrapped'     => $wrapped,
			'items'     => $items,
		];
		vt_maint_write_log_json( 'full-intro-last.json', $report );
		vt_maint_log(
			'full_intro checked=' . intval( $checked ) .
			' updated=' . intval( $updated ) .
			' skipped=' . intval( $skipped ) .
			' no_source=' . intval( $no_source ) .
			' errors=' . intval( $errors ) .
			' origin=' . ( '' === $origin ? 'all' : $origin )
		);
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_translate_slug_to_api_lang( $slug ) {
	$slug = sanitize_title( (string) $slug );
	$map  = [
		'zh' => 'zh-TW',
		'cn' => 'zh-CN',
		'ja' => 'ja',
		'en' => 'en',
		'ko' => 'ko',
		'es' => 'es',
		'hi' => 'hi',
	];
	return isset( $map[ $slug ] ) ? (string) $map[ $slug ] : 'en';
}

function vt_maint_translate_text_quick( $text, $target_lang_slug, $source_lang_slug = '' ) {
	$text = trim( wp_strip_all_tags( html_entity_decode( (string) $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ) );
	if ( '' === $text ) {
		return '';
	}

	$target_lang_slug = sanitize_title( (string) $target_lang_slug );
	$source_lang_slug = sanitize_title( (string) $source_lang_slug );

	if ( '' === $target_lang_slug ) {
		return $text;
	}
	if ( '' !== $source_lang_slug && $source_lang_slug === $target_lang_slug ) {
		return $text;
	}

	$cache_key = 'vt_tr_' . md5( $target_lang_slug . '|' . $source_lang_slug . '|' . vt_maint_lower( $text ) );
	$cached    = get_transient( $cache_key );
	if ( is_string( $cached ) && '' !== $cached ) {
		return $cached;
	}

	$target = vt_maint_translate_slug_to_api_lang( $target_lang_slug );
	$source = ( '' !== $source_lang_slug ) ? vt_maint_translate_slug_to_api_lang( $source_lang_slug ) : 'auto';

	$url = add_query_arg(
		[
			'client' => 'gtx',
			'sl'     => $source,
			'tl'     => $target,
			'dt'     => 't',
			'q'      => $text,
		],
		'https://translate.googleapis.com/translate_a/single'
	);

	$res = wp_remote_get(
		$url,
		[
			'timeout'     => 12,
			'redirection' => 2,
			'sslverify'   => false,
			'user-agent'  => 'vt-maint-translate/1.0 (+usadanews.com)',
		]
	);
	if ( is_wp_error( $res ) ) {
		return $text;
	}

	$code = intval( wp_remote_retrieve_response_code( $res ) );
	$body = (string) wp_remote_retrieve_body( $res );
	if ( $code < 200 || $code >= 300 || '' === trim( $body ) ) {
		return $text;
	}

	$data = json_decode( $body, true );
	if ( ! is_array( $data ) || ! isset( $data[0] ) || ! is_array( $data[0] ) ) {
		return $text;
	}

	$out = '';
	foreach ( (array) $data[0] as $seg ) {
		if ( is_array( $seg ) && isset( $seg[0] ) ) {
			$out .= (string) $seg[0];
		}
	}
	$out = trim( preg_replace( '/\s+/u', ' ', (string) $out ) );
	if ( '' === $out ) {
		return $text;
	}

	set_transient( $cache_key, $out, DAY_IN_SECONDS * 30 );
	return $out;
}

function vt_maint_status_label_en( $lifecycle ) {
	$lifecycle = vt_maint_normalize_life_slug( (string) $lifecycle );
	$map       = [
		'active'       => 'Active',
		'hiatus'       => 'Hiatus',
		'graduated'    => 'Graduated',
		'reincarnated' => 'Reincarnated / Past Life',
	];
	return isset( $map[ $lifecycle ] ) ? (string) $map[ $lifecycle ] : '';
}

function vt_maint_build_intro_html_for_language( $source_post_id, $target_lang, $source_lang = 'zh' ) {
	$source_post_id = intval( $source_post_id );
	$target_lang    = sanitize_title( (string) $target_lang );
	$source_lang    = sanitize_title( (string) $source_lang );
	if ( $source_post_id <= 0 || '' === $target_lang ) {
		return '';
	}

	$name = trim( (string) get_the_title( $source_post_id ) );
	if ( '' === $name ) {
		$name = trim( (string) get_post_meta( $source_post_id, 'vt_display_name', true ) );
	}
	if ( '' === $name ) {
		$name = 'VTuber';
	}

	$summary = trim( wp_strip_all_tags( (string) get_post_meta( $source_post_id, 'vt_summary', true ) ) );
	if ( '' === $summary ) {
		$summary = trim( wp_strip_all_tags( (string) get_post_field( 'post_excerpt', $source_post_id ) ) );
	}
	if ( '' === $summary ) {
		$summary = $name . ' profile summary is being prepared.';
	}

	$note = trim( wp_strip_all_tags( (string) get_post_field( 'post_excerpt', $source_post_id ) ) );
	if ( '' !== $note && vt_maint_lower( $note ) === vt_maint_lower( $summary ) ) {
		$note = '';
	}

	$translate_from = ( '' !== $source_lang ) ? $source_lang : 'zh';
	$origin         = vt_maint_lower( (string) get_post_meta( $source_post_id, 'vt_data_origin', true ) );
	if ( 'hololist' === $origin ) {
		$translate_from = 'en';
	}

	if ( $target_lang !== $translate_from ) {
		$summary = vt_maint_translate_text_quick( $summary, $target_lang, $translate_from );
		if ( '' !== $note ) {
			$note = vt_maint_translate_text_quick( $note, $target_lang, $translate_from );
		}
	}

	$affiliation  = trim( wp_strip_all_tags( (string) get_post_meta( $source_post_id, 'vt_affiliation', true ) ) );
	$debut        = trim( (string) get_post_meta( $source_post_id, 'vt_debut_date', true ) );
	$status_label = vt_maint_status_label_en( (string) get_post_meta( $source_post_id, 'vt_lifecycle_status', true ) );

	if ( $target_lang !== 'en' && $target_lang !== $translate_from ) {
		if ( '' !== $affiliation ) {
			$affiliation = vt_maint_translate_text_quick( $affiliation, $target_lang, $translate_from );
		}
		if ( '' !== $status_label ) {
			$status_label = vt_maint_translate_text_quick( $status_label, $target_lang, 'en' );
		}
	}

	$facts = [];
	if ( '' !== $affiliation ) {
		$facts[] = '<li><strong>Affiliation:</strong> ' . esc_html( $affiliation ) . '</li>';
	}
	if ( '' !== $debut ) {
		$facts[] = '<li><strong>Debut:</strong> ' . esc_html( $debut ) . '</li>';
	}
	if ( '' !== $status_label ) {
		$facts[] = '<li><strong>Status:</strong> ' . esc_html( $status_label ) . '</li>';
	}

	$links      = vt_maint_collect_intro_reference_links( $source_post_id );
	$link_items = [];
	foreach ( $links as $it ) {
		$label = esc_html( (string) ( $it['label'] ?? 'Source' ) );
		$url   = esc_url( (string) ( $it['url'] ?? '' ) );
		if ( '' === $url ) {
			continue;
		}
		$link_items[] = '<li><a href="' . $url . '" target="_blank" rel="noopener nofollow">' . $label . '</a></li>';
	}

	$html = '<div class="vt-auto-intro" data-vt-auto="1" data-vt-auto-lang="' . esc_attr( $target_lang ) . '">';
	if ( '' !== $summary ) {
		$html .= '<p>' . esc_html( vt_maint_mb_substr( $summary, 1200 ) ) . '</p>';
	}
	if ( '' !== $note ) {
		$html .= '<p><strong>Notes:</strong> ' . esc_html( vt_maint_mb_substr( $note, 500 ) ) . '</p>';
	}
	if ( ! empty( $facts ) ) {
		$html .= '<h3>Basic Info</h3><ul class="vt-auto-facts">' . implode( '', $facts ) . '</ul>';
	}
	if ( ! empty( $link_items ) ) {
		$html .= '<h3>Reference Links</h3><ul class="vt-auto-sources">' . implode( '', $link_items ) . '</ul>';
	}
	$html .= '</div>';

	return trim( $html );
}

function vt_maint_sync_translation_content_run( $batch = 20, $force = 0, $min_len = 180 ) {
	$lock_key = 'vt_maint_sync_translation_content_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 3600 ) ) {
		return [ 'locked' => 1 ];
	}

	try {
		if ( ! function_exists( 'pll_get_post_translations' ) || ! function_exists( 'pll_get_post_language' ) ) {
			return [ 'ok' => 0, 'error' => 'missing_polylang_api' ];
		}

		global $wpdb;
		$batch      = max( 5, min( 80, intval( $batch ) ) );
		$force      = intval( $force ) ? 1 : 0;
		$min_len    = max( 80, min( 800, intval( $min_len ) ) );
		$pool       = max( $batch * 6, 120 );
		$default    = vt_maint_default_lang_slug();
		$cursor_key = 'vt_maint_sync_translation_content_cursor';
		$cursor_from = intval( get_option( $cursor_key, 0 ) );
		$cursor_to   = $cursor_from;
		$wrapped     = 0;

		$checked   = 0;
		$updated   = 0;
		$skipped   = 0;
		$no_source = 0;
		$errors    = [];
		$items     = [];

		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts}
				WHERE post_type='vtuber'
				  AND post_status='publish'
				  AND ID > %d
				ORDER BY ID ASC
				LIMIT %d",
				$cursor_from,
				$pool
			)
		);
		if ( empty( $ids ) && $cursor_from > 0 ) {
			$wrapped = 1;
			$cursor_from = 0;
			$ids = $wpdb->get_col(
				$wpdb->prepare(
					"SELECT ID FROM {$wpdb->posts}
					WHERE post_type='vtuber'
					  AND post_status='publish'
					  AND ID > %d
					ORDER BY ID ASC
					LIMIT %d",
					0,
					$pool
				)
			);
		}

		foreach ( (array) $ids as $pid ) {
			$pid = intval( $pid );
			if ( $pid <= 0 ) {
				continue;
			}
			if ( $pid > $cursor_to ) {
				$cursor_to = $pid;
			}

			$src_lang = (string) pll_get_post_language( $pid, 'slug' );
			if ( '' === $src_lang ) {
				$src_lang = $default;
			}
			if ( $src_lang !== $default ) {
				continue;
			}

			$checked++;
			$map = pll_get_post_translations( $pid );
			if ( ! is_array( $map ) || count( $map ) < 2 ) {
				$skipped++;
				continue;
			}

			$source_content = trim( wp_strip_all_tags( (string) get_post_field( 'post_content', $pid ) ) );
			$source_excerpt = trim( wp_strip_all_tags( (string) get_post_field( 'post_excerpt', $pid ) ) );

			foreach ( $map as $lang => $tid ) {
				if ( $updated >= $batch ) {
					break 2;
				}
				$lang = sanitize_title( (string) $lang );
				$tid  = intval( $tid );
				if ( '' === $lang || $tid <= 0 || $tid === $pid ) {
					continue;
				}

				$current_content = (string) get_post_field( 'post_content', $tid );
				$current_excerpt = (string) get_post_field( 'post_excerpt', $tid );
				$same_as_source  = ( trim( wp_strip_all_tags( $current_content ) ) === $source_content )
					&& ( trim( wp_strip_all_tags( $current_excerpt ) ) === $source_excerpt );
				$needs_content = vt_maint_content_needs_enrich( $current_content, $min_len );
				$needs_excerpt = vt_maint_summary_needs_enrich( $current_excerpt );

				if ( ! $force && ! $needs_content && ! $needs_excerpt && ! $same_as_source ) {
					$skipped++;
					continue;
				}

				$new_content = vt_maint_build_intro_html_for_language( $pid, $lang, $src_lang );
				if ( '' === trim( $new_content ) ) {
					$no_source++;
					continue;
				}

				$excerpt_src = trim( (string) get_post_meta( $pid, 'vt_summary', true ) );
				if ( '' === $excerpt_src ) {
					$excerpt_src = trim( (string) get_post_field( 'post_excerpt', $pid ) );
				}
				if ( '' === $excerpt_src ) {
					$excerpt_src = trim( (string) get_the_title( $pid ) );
				}
				$new_excerpt = ( $lang !== $src_lang )
					? vt_maint_translate_text_quick( $excerpt_src, $lang, $src_lang )
					: $excerpt_src;
				$new_excerpt = wp_trim_words( trim( wp_strip_all_tags( (string) $new_excerpt ) ), 42 );

				$res = wp_update_post(
					[
						'ID'           => $tid,
						'post_content' => $new_content,
						'post_excerpt' => $new_excerpt,
					],
					true
				);
				if ( is_wp_error( $res ) ) {
					$errors[] = [
						'id'   => $tid,
						'lang' => $lang,
						'err'  => $res->get_error_message(),
					];
					continue;
				}

				update_post_meta( $tid, 'vt_intro_source', 'maint_auto_ml' );
				update_post_meta( $tid, 'vt_intro_refreshed_utc', gmdate( 'c' ) );
				$updated++;
				if ( count( $items ) < 60 ) {
					$items[] = [
						'id'    => $tid,
						'lang'  => $lang,
						'title' => (string) get_the_title( $tid ),
					];
				}
			}
		}

		update_option( $cursor_key, intval( $cursor_to ), false );
		$report = [
			'ok'          => 1,
			'utc'         => gmdate( 'c' ),
			'batch'       => intval( $batch ),
			'force'       => intval( $force ),
			'min_len'     => intval( $min_len ),
			'default_lang'=> $default,
			'checked'     => intval( $checked ),
			'updated'     => intval( $updated ),
			'skipped'     => intval( $skipped ),
			'no_source'   => intval( $no_source ),
			'cursor_from' => intval( $cursor_from ),
			'cursor_to'   => intval( $cursor_to ),
			'wrapped'     => intval( $wrapped ),
			'errors'      => array_slice( $errors, 0, 40 ),
			'items'       => $items,
		];
		vt_maint_write_log_json( 'translation-content-last.json', $report );
		vt_maint_log(
			'sync_translation_content checked=' . intval( $checked ) .
			' updated=' . intval( $updated ) .
			' skipped=' . intval( $skipped ) .
			' no_source=' . intval( $no_source ) .
			' errors=' . count( $errors )
		);
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_normalize_affiliation( $aff ) {
	$aff = is_string( $aff ) ? trim( wp_strip_all_tags( $aff ) ) : '';
	if ( '' === $aff ) {
		return '';
	}
	// Common separators: keep the first part.
	$parts = preg_split( '/\\s*[\\|,\\/\\-]+\\s*/u', $aff );
	$aff   = is_array( $parts ) && ! empty( $parts[0] ) ? $parts[0] : $aff;
	return trim( $aff );
}

function vt_maint_ensure_term( $taxonomy, $name, $slug = '' ) {
	$name = is_string( $name ) ? trim( $name ) : '';
	if ( '' === $name ) {
		return 0;
	}
	if ( $slug ) {
		$term = get_term_by( 'slug', $slug, $taxonomy );
		if ( $term && ! is_wp_error( $term ) ) {
			// Keep slug stable; update name if needed.
			if ( $name !== $term->name ) {
				@wp_update_term( $term->term_id, $taxonomy, [ 'name' => $name ] );
			}
			return intval( $term->term_id );
		}
		$insert = wp_insert_term( $name, $taxonomy, [ 'slug' => $slug ] );
		return is_wp_error( $insert ) ? 0 : intval( $insert['term_id'] ?? 0 );
	}

	$term = get_term_by( 'name', $name, $taxonomy );
	if ( $term && ! is_wp_error( $term ) ) {
		return intval( $term->term_id );
	}
	$insert = wp_insert_term( $name, $taxonomy );
	return is_wp_error( $insert ) ? 0 : intval( $insert['term_id'] ?? 0 );
}

if ( ! function_exists( 'vt_maint_lower' ) ) {
	function vt_maint_lower( $s ) {
		$s = is_string( $s ) ? $s : '';
		if ( function_exists( 'mb_strtolower' ) ) {
			return mb_strtolower( $s, 'UTF-8' );
		}
		return strtolower( $s );
	}
}

if ( ! function_exists( 'vt_maint_starts_with' ) ) {
	function vt_maint_starts_with( $haystack, $needle ) {
		$haystack = (string) $haystack;
		$needle   = (string) $needle;
		if ( '' === $needle ) {
			return true;
		}
		return 0 === strpos( $haystack, $needle );
	}
}

if ( ! function_exists( 'vt_maint_ends_with' ) ) {
	function vt_maint_ends_with( $haystack, $needle ) {
		$haystack = (string) $haystack;
		$needle   = (string) $needle;
		if ( '' === $needle ) {
			return true;
		}
		$len = strlen( $needle );
		if ( $len > strlen( $haystack ) ) {
			return false;
		}
		return substr( $haystack, -$len ) === $needle;
	}
}

function vt_maint_detect_role_tags( $text ) {
	$text = is_string( $text ) ? vt_maint_lower( $text ) : '';
	if ( '' === $text ) {
		return [];
	}

	// Controlled vocabulary only; avoid tag spam.
	$rules = [
		'ASMR'      => [ 'asmr', '助眠', '耳語', '耳语', 'whisper' ],
		'歌回'      => [ '歌回', '歌枠', 'karaoke', 'singing', 'cover', '歌ってみた' ],
		'雜談'      => [ '雜談', '雑談', 'chatting', 'talk', '閒聊', '闲聊', '聊天' ],
		'繪圖'      => [ '繪圖', '绘图', '畫畫', '画画', 'お絵描き', 'drawing', 'illustration', 'art stream' ],
		// Broad content tag.
		'遊戲'      => [ '遊戲', '游戏', 'game', 'gaming', '実況', '配信' ],
		// High-intent, limited list (avoid tag spam).
		'FPS'       => [ 'fps', 'apex', 'valorant', 'overwatch', 'ow2', 'pubg', 'cs2', 'counter-strike' ],
		'Minecraft' => [ 'minecraft', '麥塊', '麦块', 'マイクラ' ],
		'原神'       => [ 'genshin', '原神' ],
		'星穹鐵道'   => [ 'star rail', '星穹鐵道', '星穹铁道', '崩壞：星穹鐵道', '崩坏：星穹铁道' ],
		'FF14'      => [ 'ff14', 'ffxiv', 'final fantasy xiv' ],
	];

	$out = [];
	foreach ( $rules as $tag => $keywords ) {
		foreach ( $keywords as $kw ) {
			$needle = vt_maint_lower( $kw );
			if ( '' !== $needle && false !== strpos( $text, $needle ) ) {
				$out[] = $tag;
				break;
			}
		}
	}
	return array_values( array_unique( $out ) );
}

function vt_maint_guess_agency_from_text( $text ) {
	$text = is_string( $text ) ? vt_maint_lower( $text ) : '';
	if ( '' === $text ) {
		return '';
	}

	// Whitelist only: prevents generating thin/tag-spam pages.
	$map = [
		'Hololive'      => [ 'hololive', 'ホロライブ' ],
		'NIJISANJI'     => [ 'nijisanji', 'にじさんじ', '彩虹社' ],
		'VShojo'        => [ 'vshojo' ],
		'Phase Connect' => [ 'phase connect', 'phaseconnect' ],
		'VSPO!'         => [ 'vspo', 'ぶいすぽ' ],
		'Neo-Porte'     => [ 'neo-porte', 'neoporte', 'ネオポルテ' ],
		'神椿'            => [ 'kamitsubaki', '神椿' ],
		'春魚創意'        => [ 'springfish', '春魚', '春鱼' ],
	];

	foreach ( $map as $agency => $needles ) {
		foreach ( $needles as $n ) {
			$n = vt_maint_lower( $n );
			if ( '' !== $n && false !== strpos( $text, $n ) ) {
				return $agency;
			}
		}
	}

	return '';
}

function vt_maint_enrich_terms_run() {
	$lock_key = 'vt_maint_enrich_terms_lock';
	if ( get_transient( $lock_key ) ) {
		return [ 'locked' => 1 ];
	}
	set_transient( $lock_key, 1, 300 ); // 5 min lock
	// Larger batches can run longer on shared hosting.
	if ( VT_MAINT_TERMS_BATCH >= 100 ) {
		set_transient( $lock_key, 1, 900 ); // 15 min lock
	}

	// Ensure core terms exist and are user-friendly.
	// IMPORTANT: "個人勢/Indie" is a type tag, not an organization/agency.
	$indie_role_id = vt_maint_ensure_term( 'role-tag', '個人勢', 'indie' );
	$youtube_term  = vt_maint_ensure_term( 'platform', 'YouTube', 'youtube' );
	$twitch_term   = vt_maint_ensure_term( 'platform', 'Twitch', 'twitch' );

	$processed = 0;
	$updated   = 0;
	$skipped   = 0;
	$status_overrides = 0;
	$status_conflicts = [];

	$q = new WP_Query(
		[
			'post_type'      => 'vtuber',
			'post_status'    => 'publish',
			'posts_per_page' => VT_MAINT_TERMS_BATCH,
			'fields'         => 'ids',
			'no_found_rows'  => true,
			'meta_query'     => [
				'relation' => 'OR',
				[
					'key'     => '_vt_terms_v',
					'compare' => 'NOT EXISTS',
				],
				[
					'key'     => '_vt_terms_v',
					'value'   => VT_MAINT_TERMS_VERSION,
					'type'    => 'NUMERIC',
					'compare' => '<',
				],
			],
		]
	);

	if ( $q->have_posts() ) {
		foreach ( $q->posts as $pid ) {
			$processed++;

			$aff_raw = get_post_meta( $pid, 'vt_affiliation', true );
			$aff     = vt_maint_normalize_affiliation( $aff_raw );

			$is_indie = false;
			if ( $aff && preg_match( '/^(indie|independent|個人勢|個人|solo)$/iu', $aff ) ) {
				$is_indie = true;
			} elseif ( preg_match( '/\\b(indie|independent)\\b/iu', (string) $aff_raw ) ) {
				$is_indie = true;
			}

			// agency: prefer affiliation; then guess; else keep existing (excluding "indie").
			$existing_agency_ids = [];
			$existing_agencies   = get_the_terms( $pid, 'agency' );
			if ( ! empty( $existing_agencies ) && ! is_wp_error( $existing_agencies ) ) {
				foreach ( $existing_agencies as $t ) {
					if ( ! $t || is_wp_error( $t ) ) {
						continue;
					}
					$slug = isset( $t->slug ) ? (string) $t->slug : '';
					$name = isset( $t->name ) ? (string) $t->name : '';
					// Never carry over Indie/個人勢 as agency (legacy data may have indie-zh etc).
					if ( preg_match( '/^indie(?:-[a-z]{2,3})?$/i', $slug ) ) {
						continue;
					}
					if ( preg_match( '/^(indie|independent|solo|個人勢|個人)$/iu', trim( $name ) ) ) {
						continue;
					}
					$existing_agency_ids[] = intval( $t->term_id );
				}
			}

			$agency_ids = [];
			if ( $aff && ! $is_indie ) {
				$tid = vt_maint_ensure_term( 'agency', $aff );
				if ( $tid ) {
					$agency_ids[] = $tid;
				}
			}
			if ( empty( $agency_ids ) ) {
				$guess = vt_maint_guess_agency_from_text(
					(string) $aff_raw . "\n"
					. (string) get_the_title( $pid ) . "\n"
					. (string) get_post_meta( $pid, 'vt_summary', true ) . "\n"
					. (string) get_post_field( 'post_excerpt', $pid )
				);
				if ( $guess ) {
					$tid = vt_maint_ensure_term( 'agency', $guess );
					if ( $tid ) {
						$agency_ids[] = $tid;
					}
				}
			}
			if ( empty( $agency_ids ) && ! empty( $existing_agency_ids ) ) {
				$agency_ids = $existing_agency_ids;
			}

			// platform: determine from URLs; replace existing to avoid stale platforms.
			$platform_ids = [];
			$yt_url       = get_post_meta( $pid, 'vt_youtube_url', true );
			$tw_url       = get_post_meta( $pid, 'vt_twitch_url', true );
			if ( $yt_url && $youtube_term ) {
				$platform_ids[] = $youtube_term;
			}
			if ( $tw_url && $twitch_term ) {
				$platform_ids[] = $twitch_term;
			}
			$platform_ids = array_values( array_unique( array_filter( $platform_ids ) ) );

			// role tags: conservative, keyword-based from summary/excerpt/content.
			$summary  = get_post_meta( $pid, 'vt_summary', true );
			$text     = (string) $summary . "\n" . (string) get_the_excerpt( $pid ) . "\n" . (string) get_post_field( 'post_content', $pid );
			$role     = vt_maint_detect_role_tags( $text );
			$role_ids = [];
			foreach ( $role as $role_name ) {
				$tid = vt_maint_ensure_term( 'role-tag', $role_name );
				if ( $tid ) {
					$role_ids[] = $tid;
				}
			}
			if ( $is_indie && $indie_role_id ) {
				$role_ids[] = intval( $indie_role_id );
				$role_ids   = array_values( array_unique( array_filter( array_map( 'intval', (array) $role_ids ) ) ) );
			}

			$changed = false;

			// Always set agency terms so we can remove stale "indie" assignments.
			$r = wp_set_object_terms( $pid, array_values( array_unique( array_filter( array_map( 'intval', (array) $agency_ids ) ) ) ), 'agency', false );
			if ( ! is_wp_error( $r ) ) {
				$changed = true;
			}

			// country taxonomy (best-effort backfill).
			if ( taxonomy_exists( 'country' ) ) {
				$cc = strtoupper( trim( (string) get_post_meta( $pid, 'vt_country_code', true ) ) );
				$cn = trim( (string) get_post_meta( $pid, 'vt_country_name', true ) );
				if ( '' === $cc ) {
					$src = (string) get_post_meta( $pid, 'vt_sheet_source_slug', true );
					if ( 0 === strpos( $src, 'tw-' ) ) {
						$cc = 'TW';
						$cn = '台灣';
					}
				}
				$cc_slug = strtolower( sanitize_title( $cc ) );
				$cname   = '' !== $cn ? $cn : $cc;
				if ( '' !== $cc_slug && '' !== trim( (string) $cname ) ) {
					$tid = vt_maint_ensure_term( 'country', (string) $cname, $cc_slug );
					if ( $tid ) {
						$rr = wp_set_object_terms( $pid, [ intval( $tid ) ], 'country', false );
						if ( ! is_wp_error( $rr ) ) {
							$changed = true;
						}
					}
				}
			}

			// debut-year taxonomy (best-effort backfill).
			if ( taxonomy_exists( 'debut-year' ) ) {
				$debut_date = (string) get_post_meta( $pid, 'vt_debut_date', true );
				$debut_raw  = (string) get_post_meta( $pid, 'vt_debut_raw', true );
				$y          = vt_maint_extract_year( $debut_date );
				if ( $y <= 0 ) {
					$y = vt_maint_extract_year( $debut_raw );
				}
				if ( $y > 0 ) {
					$tid = vt_maint_ensure_term( 'debut-year', (string) $y, (string) $y );
					if ( $tid ) {
						$rr = wp_set_object_terms( $pid, [ intval( $tid ) ], 'debut-year', false );
						if ( ! is_wp_error( $rr ) ) {
							$changed = true;
						}
					}
				}
			}

			if ( ! empty( $platform_ids ) ) {
				$r = wp_set_object_terms( $pid, $platform_ids, 'platform', false );
				if ( ! is_wp_error( $r ) ) {
					$changed = true;
				}
			}

			// role-tag: keep existing manual tags, but always remove excluded tags (ex: "休止中/封存" etc).
			if ( taxonomy_exists( 'role-tag' ) ) {
				$existing_role_ids = [];
				$existing_roles    = get_the_terms( $pid, 'role-tag' );
				if ( ! empty( $existing_roles ) && ! is_wp_error( $existing_roles ) ) {
					foreach ( $existing_roles as $t ) {
						if ( ! $t || is_wp_error( $t ) ) {
							continue;
						}
						$name = isset( $t->name ) ? (string) $t->name : '';
						if ( vt_maint_is_excluded_role_tag( $name ) ) {
							continue;
						}
						$existing_role_ids[] = intval( $t->term_id );
					}
				}
				$final_role_ids = array_values(
					array_unique(
						array_filter(
							array_map(
								'intval',
								array_merge( (array) $existing_role_ids, (array) $role_ids )
							)
						)
					)
				);
				$r = wp_set_object_terms( $pid, $final_role_ids, 'role-tag', false );
				if ( ! is_wp_error( $r ) ) {
					$changed = true;
				}
			}

			// life-status: enforce a single, canonical term (prevents a post being counted as both active & hiatus etc).
			if ( taxonomy_exists( 'life-status' ) ) {
				$life    = vt_maint_normalize_life_slug( (string) get_post_meta( $pid, 'vt_lifecycle_status', true ) );
				$allowed = [ 'active', 'graduated', 'reincarnated', 'hiatus' ];
				if ( ! in_array( $life, $allowed, true ) ) {
					$life = 'active';
				}

				// If legacy data has multiple life-status terms, pick the strongest one.
				$existing = get_the_terms( $pid, 'life-status' );
				$has = [];
				if ( ! empty( $existing ) && ! is_wp_error( $existing ) ) {
					foreach ( $existing as $t ) {
						$slug = isset( $t->slug ) ? vt_maint_normalize_life_slug( (string) $t->slug ) : '';
						if ( in_array( $slug, $allowed, true ) ) {
							$has[ $slug ] = 1;
						}
					}
				}
				// Precedence: graduated > reincarnated > hiatus > active.
				foreach ( [ 'graduated', 'reincarnated', 'hiatus', 'active' ] as $want ) {
					if ( isset( $has[ $want ] ) ) {
						$life = $want;
						break;
					}
				}

				// Extra guard: infer lifecycle from text fields (sheet note / twitch bio / summary).
				$det = vt_maint_detect_lifecycle_from_texts(
					[
						(string) get_post_meta( $pid, 'vt_sheet_note', true ),
						(string) get_post_meta( $pid, 'vt_twitch_bio', true ),
						(string) get_post_meta( $pid, 'vt_summary', true ),
						(string) get_post_field( 'post_excerpt', $pid ),
					]
				);
				if ( in_array( $det, $allowed, true ) && vt_maint_lifecycle_rank( $det ) > vt_maint_lifecycle_rank( $life ) ) {
					$status_overrides++;
					$status_conflicts[] = [
						'id'        => intval( $pid ),
						'from'      => (string) $life,
						'to'        => (string) $det,
						'reason'    => 'text_inference',
						'slug'      => (string) get_post_field( 'post_name', $pid ),
						'title'     => (string) get_the_title( $pid ),
					];
					$life = $det;
				}

				$post_lang = function_exists( 'pll_get_post_language' ) ? (string) pll_get_post_language( $pid, 'slug' ) : '';
				$term_slug = vt_maint_life_slug_for_post_lang( $life, $post_lang );

				$lang_key = strtolower( trim( (string) $post_lang ) );
				if ( 0 === strpos( $lang_key, 'zh' ) || 'tw' === $lang_key ) {
					$lang_key = 'zh';
				}
				// Labels: keep zh as Chinese; other languages can be English until proper translations are provided.
				$labels = [
					'zh' => [
						'active'       => '活動中',
						'hiatus'       => '休止中',
						'graduated'    => '已畢業 / 引退',
						'reincarnated' => '轉生 / 前世',
					],
					'en' => [
						'active'       => 'Active',
						'hiatus'       => 'Hiatus',
						'graduated'    => 'Graduated / Retired',
						'reincarnated' => 'Reincarnated / Previous',
					],
					'cn' => [
						'active'       => '活动中',
						'hiatus'       => '休止中',
						'graduated'    => '已毕业 / 引退',
						'reincarnated' => '转生 / 前世',
					],
				];
				$label = $labels[ $lang_key ][ $life ] ?? $labels['en'][ $life ] ?? $labels['zh'][ $life ] ?? $life;

				$tid = vt_maint_ensure_term( 'life-status', (string) $label, (string) $term_slug );
				if ( $tid ) {
					$rr = wp_set_object_terms( $pid, [ intval( $tid ) ], 'life-status', false );
					if ( ! is_wp_error( $rr ) ) {
						update_post_meta( $pid, 'vt_lifecycle_status', $life );
						$changed = true;
					}
				}
			}

			update_post_meta( $pid, '_vt_terms_v', VT_MAINT_TERMS_VERSION );

			if ( $changed ) {
				$updated++;
			} else {
				$skipped++;
			}
		}
		wp_reset_postdata();
	}

	vt_maint_log( "enrich_terms processed=$processed updated=$updated skipped=$skipped" );
	// Write a small conflict report for inspection (helps debug cases like "bio says stopped but label shows active").
	$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
	if ( ! file_exists( $dir ) ) {
		@mkdir( $dir, 0777, true );
	}
	@file_put_contents(
		$dir . 'status-conflicts-last.json',
		wp_json_encode(
			[
				'utc'       => gmdate( 'c' ),
				'overrides' => intval( $status_overrides ),
				'items'     => array_slice( (array) $status_conflicts, 0, 500 ),
			],
			JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
		)
	);
	delete_transient( $lock_key );
	return [
		'processed' => $processed,
		'updated'   => $updated,
		'skipped'   => $skipped,
	];
}

/**
 * Targeted fixer: if bio/notes clearly say the VTuber is inactive/hiatus/graduated
 * but lifecycle is still active, update lifecycle + term in small batches.
 *
 * This complements `enrich_terms` (which is batch-based and may take time to reach specific posts).
 */
function vt_maint_status_fix_run() {
	$lock_key = 'vt_maint_status_fix_lock';
	if ( get_transient( $lock_key ) ) {
		return [ 'locked' => 1 ];
	}
	set_transient( $lock_key, 1, 900 ); // 15 min

	global $wpdb;
	$limit = 200;
	$re    = '(停止活動|停止更新|停止直播|活動休止|活動停止|無期限休止|無期限活動休止|畢業|卒業|引退|活動終了|停更|停播|停止營運|停止运营|休止|暫停|封存|archiv|hiatus|graduat|retir|inactive|no longer active|stopped streaming|활동 중단|활동 종료|휴식)';

	$sql = "
		SELECT DISTINCT p.ID
		FROM {$wpdb->posts} p
		LEFT JOIN {$wpdb->postmeta} m_life ON (m_life.post_id = p.ID AND m_life.meta_key = 'vt_lifecycle_status')
		LEFT JOIN {$wpdb->postmeta} m_note ON (m_note.post_id = p.ID AND m_note.meta_key = 'vt_sheet_note')
		LEFT JOIN {$wpdb->postmeta} m_bio  ON (m_bio.post_id  = p.ID AND m_bio.meta_key  = 'vt_twitch_bio')
		LEFT JOIN {$wpdb->postmeta} m_sum  ON (m_sum.post_id  = p.ID AND m_sum.meta_key  = 'vt_summary')
		LEFT JOIN {$wpdb->term_relationships} tr ON (tr.object_id = p.ID)
		LEFT JOIN {$wpdb->term_taxonomy} tt ON (tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'life-status')
		LEFT JOIN {$wpdb->terms} ts ON (ts.term_id = tt.term_id)
		WHERE p.post_type = 'vtuber' AND p.post_status = 'publish'
		  AND (
				-- If taxonomy is explicitly active (or active-xx), treat as active regardless of meta.
				(ts.slug IS NOT NULL AND ts.slug REGEXP '^active(-[a-z]{2,3})?$')
				-- If taxonomy is missing, fall back to meta being active/empty.
				OR (
					ts.slug IS NULL AND (
						m_life.meta_value IS NULL
						OR m_life.meta_value = ''
						OR m_life.meta_value = 'active'
						OR m_life.meta_value REGEXP '^active(-[a-z]{2,3})?$'
					)
				)
		  )
		  AND (
			 (m_note.meta_value IS NOT NULL AND m_note.meta_value REGEXP %s)
			  OR (m_bio.meta_value IS NOT NULL AND m_bio.meta_value REGEXP %s)
			  OR (m_sum.meta_value IS NOT NULL AND m_sum.meta_value REGEXP %s)
			  OR (p.post_excerpt IS NOT NULL AND p.post_excerpt REGEXP %s)
			  OR (p.post_content IS NOT NULL AND p.post_content REGEXP %s)
		  )
		-- Prefer recently modified posts so old IDs that got updated by sheet/hololist are still fixed.
		ORDER BY p.post_modified_gmt DESC, p.ID DESC
		LIMIT %d
	";
	$ids = $wpdb->get_col( $wpdb->prepare( $sql, $re, $re, $re, $re, $re, $limit ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	if ( ! is_array( $ids ) ) {
		$ids = [];
	}

	$updated = 0;
	$checked = 0;
	$items   = [];

	foreach ( $ids as $pid ) {
		$pid = intval( $pid );
		if ( $pid <= 0 ) {
			continue;
		}
		$checked++;

		$cur = '';
		$terms = taxonomy_exists( 'life-status' ) ? get_the_terms( $pid, 'life-status' ) : [];
		if ( ! empty( $terms ) && ! is_wp_error( $terms ) ) {
			$t = reset( $terms );
			if ( $t && ! empty( $t->slug ) ) {
				$cur = vt_maint_normalize_life_slug( (string) $t->slug );
			}
		}
		if ( '' === $cur ) {
			$cur = vt_maint_normalize_life_slug( (string) get_post_meta( $pid, 'vt_lifecycle_status', true ) );
		}
		if ( '' === $cur ) {
			$cur = 'active';
		}

		$det = vt_maint_detect_lifecycle_from_texts(
			[
				(string) get_post_meta( $pid, 'vt_sheet_note', true ),
				(string) get_post_meta( $pid, 'vt_twitch_bio', true ),
				(string) get_post_meta( $pid, 'vt_summary', true ),
				(string) get_post_field( 'post_excerpt', $pid ),
				(string) get_post_field( 'post_content', $pid ),
			]
		);

		if ( vt_maint_lifecycle_rank( $det ) <= vt_maint_lifecycle_rank( $cur ) ) {
			continue;
		}

		update_post_meta( $pid, 'vt_lifecycle_status', $det );
		if ( taxonomy_exists( 'life-status' ) ) {
			$post_lang = function_exists( 'pll_get_post_language' ) ? (string) pll_get_post_language( $pid, 'slug' ) : '';
			$slug      = vt_maint_life_slug_for_post_lang( $det, $post_lang );
			$lang_key = strtolower( trim( (string) $post_lang ) );
			if ( 0 === strpos( $lang_key, 'zh' ) || 'tw' === $lang_key ) {
				$lang_key = 'zh';
			}
			$labels = [
				'zh' => [
					'active'       => '活動中',
					'hiatus'       => '休止中',
					'graduated'    => '已畢業 / 引退',
					'reincarnated' => '轉生 / 前世',
				],
				'en' => [
					'active'       => 'Active',
					'hiatus'       => 'Hiatus',
					'graduated'    => 'Graduated / Retired',
					'reincarnated' => 'Reincarnated / Previous',
				],
				'cn' => [
					'active'       => '活动中',
					'hiatus'       => '休止中',
					'graduated'    => '已毕业 / 引退',
					'reincarnated' => '转生 / 前世',
				],
				'ko' => [
					'active'       => 'Active',
					'hiatus'       => 'Hiatus',
					'graduated'    => 'Graduated / Retired',
					'reincarnated' => 'Reincarnated / Previous',
				],
				'es' => [
					'active'       => 'Active',
					'hiatus'       => 'Hiatus',
					'graduated'    => 'Graduated / Retired',
					'reincarnated' => 'Reincarnated / Previous',
				],
				'hi' => [
					'active'       => 'Active',
					'hiatus'       => 'Hiatus',
					'graduated'    => 'Graduated / Retired',
					'reincarnated' => 'Reincarnated / Previous',
				],
			];
			$label = $labels[ $lang_key ][ $det ] ?? $labels['en'][ $det ] ?? $labels['zh'][ $det ] ?? $det;
			$tid       = vt_maint_ensure_term( 'life-status', $label, $slug );
			if ( $tid ) {
				@wp_set_object_terms( $pid, [ intval( $tid ) ], 'life-status', false );
			}
		}
		$updated++;
		$items[] = [
			'id'    => $pid,
			'from'  => $cur,
			'to'    => $det,
			'slug'  => (string) get_post_field( 'post_name', $pid ),
			'title' => (string) get_the_title( $pid ),
		];
	}

	$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
	if ( ! file_exists( $dir ) ) {
		@mkdir( $dir, 0777, true );
	}
	// Avoid overwriting the last useful report with an empty run.
	if ( $checked > 0 || $updated > 0 ) {
		@file_put_contents(
			$dir . 'status-fix-last.json',
			wp_json_encode(
				[
					'utc'     => gmdate( 'c' ),
					'checked' => intval( $checked ),
					'updated' => intval( $updated ),
					'items'   => array_slice( (array) $items, 0, 500 ),
				],
				JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
			)
		);
	}

	delete_transient( $lock_key );
	vt_maint_log( 'status_fix checked=' . intval( $checked ) . ' updated=' . intval( $updated ) );
	return [ 'checked' => intval( $checked ), 'updated' => intval( $updated ) ];
}

function vt_maint_title_key( $raw ) {
	$s = is_string( $raw ) ? trim( wp_strip_all_tags( $raw ) ) : '';
	if ( '' === $s ) {
		return '';
	}
	$s = preg_replace( '/\s+/u', ' ', $s );
	$s = preg_replace( '/\b(channel|official|ch)\b/iu', '', $s );
	$s = preg_replace( '/[\\p{P}\\p{S}\\s]+/u', '', $s );
	return vt_maint_lower( (string) $s );
}

function vt_maint_name_signature( $raw ) {
	$s = is_string( $raw ) ? trim( wp_strip_all_tags( $raw ) ) : '';
	if ( '' === $s ) {
		return [
			'raw'           => '',
			'base_key'      => '',
			'cjk_key'       => '',
			'latin_tokens'  => [],
			'latin_compact' => '',
		];
	}

	$base_key = vt_maint_title_key( $s );

	$cjk = preg_replace( '/[^\\p{Han}\\p{Hiragana}\\p{Katakana}\\p{Hangul}]+/u', '', $s );
	$cjk = trim( (string) $cjk );

	$latin_src = vt_maint_lower( $s );
	$latin_src = preg_replace( '/[^a-z0-9\\s]+/i', ' ', (string) $latin_src );
	$parts     = preg_split( '/\\s+/', trim( (string) $latin_src ) );
	$tokens    = [];
	$stop      = [
		'ch', 'channel', 'official', 'offical', 'vtuber', 'vtuver', 'chann', 'live', 'clips', 'clip',
	];
	if ( is_array( $parts ) ) {
		foreach ( $parts as $p ) {
			$p = trim( (string) $p );
			if ( '' === $p || strlen( $p ) < 2 ) {
				continue;
			}
			if ( in_array( $p, $stop, true ) ) {
				continue;
			}
			$tokens[] = $p;
		}
	}
	$tokens = array_values( array_unique( $tokens ) );
	sort( $tokens );

	return [
		'raw'           => $s,
		'base_key'      => $base_key,
		'cjk_key'       => $cjk,
		'latin_tokens'  => $tokens,
		'latin_compact' => implode( '', $tokens ),
	];
}

function vt_maint_name_similarity_score( $a, $b ) {
	$a = is_array( $a ) ? $a : [];
	$b = is_array( $b ) ? $b : [];
	$score = 0;

	$a_base = (string) ( $a['base_key'] ?? '' );
	$b_base = (string) ( $b['base_key'] ?? '' );
	if ( '' !== $a_base && '' !== $b_base && $a_base === $b_base ) {
		$score += 8;
	}

	$a_cjk = (string) ( $a['cjk_key'] ?? '' );
	$b_cjk = (string) ( $b['cjk_key'] ?? '' );
	if ( '' !== $a_cjk && '' !== $b_cjk ) {
		if ( $a_cjk === $b_cjk ) {
			$score += 8;
		} elseif ( strlen( $a_cjk ) >= 4 && strlen( $b_cjk ) >= 4 && ( false !== strpos( $a_cjk, $b_cjk ) || false !== strpos( $b_cjk, $a_cjk ) ) ) {
			$score += 5;
		}
	}

	$a_lc = (string) ( $a['latin_compact'] ?? '' );
	$b_lc = (string) ( $b['latin_compact'] ?? '' );
	if ( '' !== $a_lc && '' !== $b_lc ) {
		if ( $a_lc === $b_lc ) {
			$score += 7;
		} elseif ( strlen( $a_lc ) >= 6 && strlen( $b_lc ) >= 6 && ( false !== strpos( $a_lc, $b_lc ) || false !== strpos( $b_lc, $a_lc ) ) ) {
			$score += 4;
		}
	}

	$a_tokens = isset( $a['latin_tokens'] ) && is_array( $a['latin_tokens'] ) ? $a['latin_tokens'] : [];
	$b_tokens = isset( $b['latin_tokens'] ) && is_array( $b['latin_tokens'] ) ? $b['latin_tokens'] : [];
	if ( ! empty( $a_tokens ) && ! empty( $b_tokens ) ) {
		$inter = array_values( array_intersect( $a_tokens, $b_tokens ) );
		$ic    = count( $inter );
		if ( $ic >= 2 ) {
			$score += 5;
		} elseif ( 1 === $ic ) {
			$t = (string) $inter[0];
			$score += strlen( $t ) >= 5 ? 3 : 1;
		}
	}

	return intval( $score );
}

function vt_maint_index_name_signature( &$by_cjk, &$by_latin, &$by_token, &$sig_by_post, $post_id, $sig ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 || ! is_array( $sig ) ) {
		return;
	}
	$sig_by_post[ $post_id ] = $sig;

	$cjk = (string) ( $sig['cjk_key'] ?? '' );
	if ( '' !== $cjk ) {
		if ( ! isset( $by_cjk[ $cjk ] ) || ! is_array( $by_cjk[ $cjk ] ) ) {
			$by_cjk[ $cjk ] = [];
		}
		$by_cjk[ $cjk ][] = $post_id;
		$by_cjk[ $cjk ]   = array_values( array_unique( array_map( 'intval', $by_cjk[ $cjk ] ) ) );
	}

	$latin_compact = (string) ( $sig['latin_compact'] ?? '' );
	if ( '' !== $latin_compact ) {
		if ( ! isset( $by_latin[ $latin_compact ] ) || ! is_array( $by_latin[ $latin_compact ] ) ) {
			$by_latin[ $latin_compact ] = [];
		}
		$by_latin[ $latin_compact ][] = $post_id;
		$by_latin[ $latin_compact ]   = array_values( array_unique( array_map( 'intval', $by_latin[ $latin_compact ] ) ) );
	}

	$tokens = isset( $sig['latin_tokens'] ) && is_array( $sig['latin_tokens'] ) ? $sig['latin_tokens'] : [];
	foreach ( $tokens as $token ) {
		$token = trim( (string) $token );
		if ( '' === $token ) {
			continue;
		}
		if ( ! isset( $by_token[ $token ] ) || ! is_array( $by_token[ $token ] ) ) {
			$by_token[ $token ] = [];
		}
		$by_token[ $token ][] = $post_id;
		$by_token[ $token ]   = array_values( array_unique( array_map( 'intval', $by_token[ $token ] ) ) );
	}
}

function vt_maint_parse_int( $raw ) {
	$s = is_string( $raw ) ? trim( $raw ) : (string) $raw;
	if ( '' === $s ) {
		return 0;
	}
	$s = preg_replace( '/[^\d]/', '', $s );
	return intval( $s );
}

function vt_maint_parse_date_for_acf( $raw ) {
	$s = is_string( $raw ) ? trim( $raw ) : '';
	if ( '' === $s ) {
		return '';
	}
	if ( preg_match( '/^(20\d{2})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/', $s, $m ) ) {
		return sprintf( '%04d%02d%02d', intval( $m[1] ), intval( $m[2] ), intval( $m[3] ) );
	}
	return '';
}

function vt_maint_extract_year( $raw ) {
	$s = trim( (string) $raw );
	if ( '' === $s ) {
		return 0;
	}
	if ( preg_match( '/\b(19\d{2}|20\d{2})\b/', $s, $m ) ) {
		$y = intval( $m[1] );
		if ( $y >= 1900 && $y <= 2100 ) {
			return $y;
		}
	}
	// Also support ACF date format "YYYYMMDD".
	if ( preg_match( '/^(19\d{2}|20\d{2})\d{4}$/', $s, $m ) ) {
		$y = intval( $m[1] );
		if ( $y >= 1900 && $y <= 2100 ) {
			return $y;
		}
	}
	return 0;
}

function vt_maint_detect_lifecycle_slug( $note ) {
	$t = vt_maint_lower( (string) $note );
	if ( '' === trim( $t ) ) {
		return 'active';
	}
	if ( false !== strpos( $t, '轉生' ) || false !== strpos( $t, '前世' ) || false !== strpos( $t, 'reincarn' ) ) {
		return 'reincarnated';
	}
	if ( false !== strpos( $t, '畢業' ) || false !== strpos( $t, '卒業' ) || false !== strpos( $t, '引退' ) || false !== strpos( $t, 'graduat' ) ) {
		return 'graduated';
	}
	if ( false !== strpos( $t, '休止' ) || false !== strpos( $t, '暫停' ) || false !== strpos( $t, 'hiatus' ) ) {
		return 'hiatus';
	}
	return 'active';
}

/**
 * Normalize Polylang-translated life-status term slugs back to canonical base slugs.
 *
 * Examples:
 * - active-ko -> active
 * - hiatus-zh -> hiatus
 */
function vt_maint_normalize_life_slug( $raw_slug ) {
	$s = sanitize_title( (string) $raw_slug );
	if ( preg_match( '/^(active|graduated|reincarnated|hiatus)(?:-[a-z]{2,3})?$/i', $s, $m ) ) {
		return strtolower( (string) $m[1] );
	}
	return $s;
}

/**
 * Decide the life-status term slug to set for a given post language.
 *
 * We keep default zh as base slugs: active/hiatus/graduated/reincarnated.
 * Other languages prefer suffix: active-en, hiatus-ko, etc.
 */
function vt_maint_life_slug_for_post_lang( $base_slug, $post_lang ) {
	$base = vt_maint_normalize_life_slug( $base_slug );
	$lang = strtolower( trim( (string) $post_lang ) );
	if ( '' === $lang ) {
		return $base;
	}
	// Treat any zh* as the default language (no suffix).
	if ( 0 === strpos( $lang, 'zh' ) || 'tw' === $lang ) {
		return $base;
	}
	$allowed = [ 'cn', 'ja', 'en', 'ko', 'es', 'hi' ];
	if ( in_array( $lang, $allowed, true ) ) {
		return $base . '-' . $lang;
	}
	return $base;
}

function vt_maint_lifecycle_rank( $slug ) {
	$s = vt_maint_normalize_life_slug( (string) $slug );
	if ( 'graduated' === $s ) {
		return 30;
	}
	if ( 'reincarnated' === $s ) {
		return 25;
	}
	if ( 'hiatus' === $s ) {
		return 20;
	}
	return 10; // active / unknown
}

/**
 * Best-effort inference of lifecycle from text fields.
 *
 * This is intentionally conservative: only promote to a "stronger" status
 * when we see high-signal keywords (ex: 畢業/引退/停止活動/休止).
 */
function vt_maint_detect_lifecycle_from_texts( $texts ) {
	if ( ! is_array( $texts ) ) {
		$texts = [ $texts ];
	}
	$raw = '';
	foreach ( $texts as $t ) {
		$t = is_string( $t ) ? trim( wp_strip_all_tags( $t ) ) : '';
		if ( '' !== $t ) {
			$raw .= "\n" . $t;
		}
	}
	$t = vt_maint_lower( $raw );
	if ( '' === trim( $t ) ) {
		return 'active';
	}

	// 1) Graduated / retired signals.
	if (
		false !== strpos( $t, '畢業' )
		|| false !== strpos( $t, '卒業' )
		|| false !== strpos( $t, '引退' )
		|| false !== strpos( $t, '退役' )
		|| false !== strpos( $t, '活動終了' )
		|| ( false !== strpos( $t, '停止' ) && ( false !== strpos( $t, '活動' ) || false !== strpos( $t, '直播' ) || false !== strpos( $t, '更新' ) ) && false !== strpos( $t, '永久' ) )
		|| false !== strpos( $t, '永久停止' )
		|| false !== strpos( $t, '不再活動' )
		|| false !== strpos( $t, '不再更新' )
		|| false !== strpos( $t, 'graduat' )
		|| false !== strpos( $t, 'retir' )
		|| false !== strpos( $t, 'no longer active' )
		|| false !== strpos( $t, 'no longer streaming' )
		|| false !== strpos( $t, 'stopped streaming' )
		|| false !== strpos( $t, '활동 종료' )
	) {
		return 'graduated';
	}

	// 2) Hiatus / inactive signals.
	if (
		false !== strpos( $t, '休止' )
		|| false !== strpos( $t, '暫停' )
		|| false !== strpos( $t, '活動休止' )
		|| false !== strpos( $t, '活動停止' )
		|| false !== strpos( $t, '無期限休止' )
		|| false !== strpos( $t, '無期限活動休止' )
		|| false !== strpos( $t, '停止活動' )
		|| false !== strpos( $t, '停止更新' )
		|| false !== strpos( $t, '停止直播' )
		|| false !== strpos( $t, '停更' )
		|| false !== strpos( $t, '停播' )
		|| false !== strpos( $t, '停止營運' )
		|| false !== strpos( $t, '停止运营' )
		|| false !== strpos( $t, '封存' )
		|| false !== strpos( $t, 'archiv' )
		|| false !== strpos( $t, 'hiatus' )
		|| false !== strpos( $t, 'inactive' )
		|| false !== strpos( $t, 'on break' )
		|| false !== strpos( $t, 'indefinite' )
		|| false !== strpos( $t, '休眠' )
		|| false !== strpos( $t, '활동 중단' )
		|| false !== strpos( $t, '휴식' )
	) {
		return 'hiatus';
	}

	// Reincarnation is intentionally not inferred from bio/summary to avoid privacy leaks.
	return 'active';
}

function vt_maint_is_excluded_role_tag( $tag_name ) {
	$name = trim( (string) $tag_name );
	if ( '' === $name ) {
		return true;
	}
	// Do not expose sensitive or confusing tags in public tag UI/import roles.
	// - reincarnation is intentionally hidden
	// - life-status should only live in the `life-status` taxonomy (avoid showing both "活動中" + "休止中" etc.)
	return (bool) preg_match( '/(轉生|转生|reincarn|前世)/iu', $name )
		|| (bool) preg_match( '/(活動中|休止|暫停|畢業|卒業|引退|封存|archiv|hiatus|graduat|active)/iu', $name );
}

function vt_maint_sheet_api_key() {
	$key = defined( 'VT_SHEETS_API_KEY' ) ? VT_SHEETS_API_KEY : '';
	if ( '' === trim( (string) $key ) ) {
		$key = defined( 'VT_MAINT_SHEETS_API_KEY' ) ? VT_MAINT_SHEETS_API_KEY : '';
	}
	if ( '' === trim( (string) $key ) ) {
		$key = get_option( 'vt_sheets_api_key', '' );
	}
	if ( '' === trim( (string) $key ) ) {
		$key = defined( 'VT_YT_API_KEY' ) ? VT_YT_API_KEY : get_option( 'vt_youtube_api_key', '' );
	}
	return trim( (string) $key );
}

function vt_maint_require_media_api() {
	if ( ! function_exists( 'download_url' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
	}
	if ( ! function_exists( 'media_handle_sideload' ) ) {
		require_once ABSPATH . 'wp-admin/includes/media.php';
	}
	if ( ! function_exists( 'wp_generate_attachment_metadata' ) ) {
		require_once ABSPATH . 'wp-admin/includes/image.php';
	}
}

function vt_maint_fetch_sheet_titles( $spreadsheet_id, $api_key ) {
	$res = wp_remote_get(
		add_query_arg(
			[
				'includeGridData' => 'false',
				'fields'          => 'sheets(properties(sheetId,title))',
				'key'             => $api_key,
			],
			'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode( (string) $spreadsheet_id )
		),
		[ 'timeout' => 30 ]
	);
	if ( is_wp_error( $res ) ) {
		return [ 'ok' => 0, 'error' => $res->get_error_message(), 'titles' => [] ];
	}
	$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
	if ( ! is_array( $data ) || ! isset( $data['sheets'] ) || ! is_array( $data['sheets'] ) ) {
		return [ 'ok' => 0, 'error' => 'invalid_sheet_meta', 'titles' => [] ];
	}
	$map = [];
	foreach ( $data['sheets'] as $sheet ) {
		$props = isset( $sheet['properties'] ) && is_array( $sheet['properties'] ) ? $sheet['properties'] : [];
		$gid   = intval( $props['sheetId'] ?? 0 );
		$title = trim( (string) ( $props['title'] ?? '' ) );
		if ( $gid > 0 && '' !== $title ) {
			$map[ $gid ] = $title;
		}
	}
	return [ 'ok' => 1, 'titles' => $map ];
}

function vt_maint_sheet_normalize_header( $label ) {
	$s = vt_maint_lower( trim( (string) $label ) );
	$s = str_replace( [ "\n", "\r", "\t", ' ', '／', '/', '\\', '-', '_', '　' ], '', $s );
	return $s;
}

function vt_maint_sheet_extract_cell_url( $cell ) {
	if ( ! is_array( $cell ) ) {
		return '';
	}
	$url = trim( (string) ( $cell['hyperlink'] ?? '' ) );
	if ( '' !== $url ) {
		return $url;
	}
	if ( isset( $cell['textFormatRuns'] ) && is_array( $cell['textFormatRuns'] ) ) {
		foreach ( $cell['textFormatRuns'] as $run ) {
			$url = trim( (string) ( $run['format']['link']['uri'] ?? '' ) );
			if ( '' !== $url ) {
				return $url;
			}
		}
	}
	$formula = trim( (string) ( $cell['userEnteredValue']['formulaValue'] ?? '' ) );
	if ( '' !== $formula && preg_match( '/HYPERLINK\(\"([^\"]+)\"/i', $formula, $m ) ) {
		return trim( (string) $m[1] );
	}
	$text = trim( (string) ( $cell['formattedValue'] ?? '' ) );
	if ( preg_match( '#https?://[^\s<>"\']+#i', $text, $m ) ) {
		return trim( (string) $m[0] );
	}
	return '';
}

function vt_maint_sheet_cell_text( $cells, $idx ) {
	if ( ! isset( $cells[ $idx ] ) || ! is_array( $cells[ $idx ] ) ) {
		return '';
	}
	return trim( (string) ( $cells[ $idx ]['formattedValue'] ?? '' ) );
}

function vt_maint_sheet_cell_url( $cells, $idx ) {
	if ( ! isset( $cells[ $idx ] ) || ! is_array( $cells[ $idx ] ) ) {
		return '';
	}
	return vt_maint_sheet_extract_cell_url( $cells[ $idx ] );
}

function vt_maint_sheet_is_marker( $text ) {
	$s = vt_maint_lower( trim( (string) $text ) );
	if ( '' === $s ) {
		return true;
	}
	return in_array( $s, [ 'v', 'x', 'o', 'ok', 'yes', '1' ], true );
}

function vt_maint_sheet_find_col( $headers, $needles ) {
	foreach ( $needles as $needle ) {
		$needle_n = vt_maint_sheet_normalize_header( $needle );
		foreach ( $headers as $idx => $header ) {
			$h = vt_maint_sheet_normalize_header( $header );
			if ( '' !== $h && false !== strpos( $h, $needle_n ) ) {
				return intval( $idx );
			}
		}
	}
	return -1;
}

function vt_maint_sheet_col_or_default( $found_idx, $default_idx ) {
	$found = intval( $found_idx );
	return $found >= 0 ? $found : intval( $default_idx );
}

function vt_maint_sheet_guess_title( $cells, $youtube_col, $twitch_col ) {
	$indexes = [];
	foreach ( [ $youtube_col, 0, 1, 2, 3, $twitch_col ] as $i ) {
		if ( $i >= 0 && ! in_array( $i, $indexes, true ) ) {
			$indexes[] = $i;
		}
	}
	foreach ( $indexes as $idx ) {
		$text = vt_maint_sheet_cell_text( $cells, $idx );
		if ( vt_maint_sheet_is_marker( $text ) ) {
			continue;
		}
		if ( preg_match( '/^20\d{2}[\/\.-]\d{1,2}[\/\.-]\d{1,2}$/', $text ) ) {
			continue;
		}
		if ( preg_match( '/^\d+$/', $text ) ) {
			continue;
		}
		return $text;
	}
	return '';
}

function vt_maint_clean_url( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return '';
	}
	// Add scheme when missing.
	if ( ! preg_match( '#^https?://#i', $url ) && preg_match( '/^[A-Za-z0-9_.-]+\.[A-Za-z]{2,}\/.+$/', $url ) ) {
		$url = 'https://' . $url;
	}
	if ( ! preg_match( '#^https?://#i', $url ) ) {
		return '';
	}

	$parsed = wp_parse_url( $url );
	if ( ! is_array( $parsed ) ) {
		return esc_url_raw( $url );
	}

	$host = strtolower( (string) ( $parsed['host'] ?? '' ) );
	$path = (string) ( $parsed['path'] ?? '/' );
	$path = '/' . ltrim( $path, '/' );

	// Drop tracking queries/fragments for canonicalization.
	$host = preg_replace( '/^www\\./i', '', $host );

	// Canonicalize common social URLs to reduce duplicates from mixed formats.
	// YouTube
	if ( in_array( $host, [ 'youtube.com', 'm.youtube.com', 'music.youtube.com' ], true ) ) {
		if ( preg_match( '#^/channel/(UC[0-9A-Za-z_-]{20,})#', $path, $m ) ) {
			return 'https://www.youtube.com/channel/' . $m[1];
		}
		if ( preg_match( '#^/@([0-9A-Za-z_.-]{2,})#', $path, $m ) ) {
			return 'https://www.youtube.com/@' . strtolower( $m[1] );
		}
		// Keep other paths but strip trailing slash.
		$clean = 'https://www.youtube.com' . rtrim( $path, '/' );
		return esc_url_raw( $clean );
	}
	if ( 'youtu.be' === $host ) {
		$seg = trim( $path, '/' );
		if ( $seg !== '' ) {
			return esc_url_raw( 'https://youtu.be/' . $seg );
		}
	}

	// Twitch
	if ( in_array( $host, [ 'twitch.tv', 'www.twitch.tv' ], true ) ) {
		$seg = trim( $path, '/' );
		if ( $seg !== '' && false === strpos( $seg, '/' ) ) {
			return esc_url_raw( 'https://www.twitch.tv/' . strtolower( $seg ) );
		}
		return esc_url_raw( 'https://www.twitch.tv' . rtrim( $path, '/' ) );
	}

	// X/Twitter
	if ( in_array( $host, [ 'x.com', 'twitter.com', 'mobile.twitter.com', 'www.twitter.com' ], true ) ) {
		$seg = trim( $path, '/' );
		if ( $seg !== '' ) {
			$seg = strtolower( preg_replace( '/[^0-9a-z_]/i', '', explode( '/', $seg )[0] ) );
			if ( $seg !== '' ) {
				return esc_url_raw( 'https://x.com/' . $seg );
			}
		}
	}

	// Generic: normalize scheme + host + path only.
	$clean = 'https://' . $host . rtrim( $path, '/' );
	return esc_url_raw( $clean );
}

function vt_maint_fetch_sheet_rows( $spreadsheet_id, $sheet_title, $api_key ) {
	// Primary path: lightweight Values API to avoid memory spikes from includeGridData payloads.
	$range = "'" . $sheet_title . "'!A1:P5000";
	$url   = 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode( (string) $spreadsheet_id ) . '/values/' . rawurlencode( $range );
	$res   = wp_remote_get(
		add_query_arg(
			[
				'majorDimension'   => 'ROWS',
				'valueRenderOption'=> 'FORMATTED_VALUE',
				'key'              => $api_key,
			],
			$url
		),
		[ 'timeout' => 60 ]
	);
	if ( ! is_wp_error( $res ) ) {
		$data   = json_decode( (string) wp_remote_retrieve_body( $res ), true );
		$values = isset( $data['values'] ) && is_array( $data['values'] ) ? $data['values'] : [];
		if ( ! empty( $values ) ) {
			$rows = [];
			foreach ( $values as $line ) {
				$cells = [];
				foreach ( (array) $line as $v ) {
					$cells[] = [ 'formattedValue' => is_scalar( $v ) ? (string) $v : '' ];
				}
				$rows[] = [ 'values' => $cells ];
			}
			return [ 'ok' => 1, 'rows' => $rows, 'source' => 'values_api' ];
		}
	}

	// Fallback: reduced grid payload (keeps hyperlink fields when needed).
	$params = [
		'ranges'          => "'" . $sheet_title . "'!A1:P2500",
		'includeGridData' => 'true',
		'fields'          => 'sheets(data(rowData(values(formattedValue,hyperlink,userEnteredValue))))',
		'key'             => $api_key,
	];
	$res = wp_remote_get(
		add_query_arg( $params, 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode( (string) $spreadsheet_id ) ),
		[ 'timeout' => 80 ]
	);
	if ( is_wp_error( $res ) ) {
		return [ 'ok' => 0, 'error' => $res->get_error_message(), 'rows' => [] ];
	}
	$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
	$rows = $data['sheets'][0]['data'][0]['rowData'] ?? [];
	if ( ! is_array( $rows ) ) {
		return [ 'ok' => 0, 'error' => 'invalid_sheet_rows', 'rows' => [] ];
	}
	return [ 'ok' => 1, 'rows' => $rows, 'source' => 'grid_api' ];
}

function vt_maint_fetch_sheet_rows_csv( $spreadsheet_id, $gid ) {
	$gid = intval( $gid );
	if ( '' === trim( (string) $spreadsheet_id ) || $gid <= 0 ) {
		return [ 'ok' => 0, 'error' => 'invalid_sheet_or_gid', 'rows' => [] ];
	}
	$url = add_query_arg(
		[
			'format' => 'csv',
			'gid'    => $gid,
		],
		'https://docs.google.com/spreadsheets/d/' . rawurlencode( (string) $spreadsheet_id ) . '/export'
	);
	$res = wp_remote_get(
		$url,
		[
			'timeout' => 45,
			'headers' => [ 'User-Agent' => 'vt-maint-runner/1.0 (+csv-fallback)' ],
		]
	);
	if ( is_wp_error( $res ) ) {
		return [ 'ok' => 0, 'error' => $res->get_error_message(), 'rows' => [] ];
	}
	$code = intval( wp_remote_retrieve_response_code( $res ) );
	$body = (string) wp_remote_retrieve_body( $res );
	if ( $code < 200 || $code >= 300 || '' === trim( $body ) ) {
		return [ 'ok' => 0, 'error' => 'csv_export_http_' . $code, 'rows' => [] ];
	}

	$lines = preg_split( "/\r\n|\n|\r/", $body );
	if ( ! is_array( $lines ) || empty( $lines ) ) {
		return [ 'ok' => 0, 'error' => 'csv_export_empty', 'rows' => [] ];
	}

	$rows = [];
	foreach ( $lines as $line ) {
		if ( null === $line ) {
			continue;
		}
		$cells = str_getcsv( (string) $line );
		if ( ! is_array( $cells ) ) {
			continue;
		}
		$values = [];
		foreach ( $cells as $cell ) {
			$values[] = [ 'formattedValue' => (string) $cell ];
		}
		$rows[] = [ 'values' => $values ];
	}
	if ( empty( $rows ) ) {
		return [ 'ok' => 0, 'error' => 'csv_export_no_rows', 'rows' => [] ];
	}
	return [ 'ok' => 1, 'rows' => $rows, 'source' => 'csv_export' ];
}

function vt_maint_sheet_col_letter( $idx ) {
	$idx = intval( $idx );
	if ( $idx < 0 ) {
		return '';
	}
	$s = '';
	$n = $idx + 1;
	while ( $n > 0 ) {
		$mod = ( $n - 1 ) % 26;
		$s   = chr( 65 + $mod ) . $s;
		$n   = intval( ( $n - 1 ) / 26 );
	}
	return $s;
}

function vt_maint_sheet_fetch_column_grid_cells( $spreadsheet_id, $sheet_title, $col_letter, $row_max, $api_key ) {
	$col_letter = trim( (string) $col_letter );
	$row_max    = max( 2, min( 8000, intval( $row_max ) ) );
	if ( '' === $col_letter ) {
		return [ 'ok' => 0, 'rows' => [], 'error' => 'missing_col_letter' ];
	}
	$params = [
		'ranges'          => "'" . $sheet_title . "'!" . $col_letter . '1:' . $col_letter . $row_max,
		'includeGridData' => 'true',
		// Keep payload small but include rich-text links too.
		'fields'          => 'sheets(data(rowData(values(formattedValue,hyperlink,textFormatRuns(format(link)),userEnteredValue))))',
		'key'             => $api_key,
	];
	$res = wp_remote_get(
		add_query_arg( $params, 'https://sheets.googleapis.com/v4/spreadsheets/' . rawurlencode( (string) $spreadsheet_id ) ),
		[ 'timeout' => 80 ]
	);
	if ( is_wp_error( $res ) ) {
		return [ 'ok' => 0, 'rows' => [], 'error' => $res->get_error_message() ];
	}
	$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
	$rows = $data['sheets'][0]['data'][0]['rowData'] ?? [];
	if ( ! is_array( $rows ) ) {
		return [ 'ok' => 0, 'rows' => [], 'error' => 'invalid_grid_rows' ];
	}
	return [ 'ok' => 1, 'rows' => $rows, 'error' => '' ];
}

function vt_maint_sheet_attach_hyperlinks_for_columns( &$rows, $spreadsheet_id, $sheet_title, $col_indexes, $api_key ) {
	if ( ! is_array( $rows ) || empty( $rows ) ) {
		return;
	}
	if ( ! isset( $rows[0]['values'] ) || ! is_array( $rows[0]['values'] ) ) {
		return;
	}
	$col_indexes = array_values( array_unique( array_filter( array_map( 'intval', (array) $col_indexes ), function ( $n ) { return $n >= 0; } ) ) );
	if ( empty( $col_indexes ) ) {
		return;
	}
	$row_max = min( 8000, max( 2, count( $rows ) ) );
	foreach ( $col_indexes as $col_idx ) {
		$letter = vt_maint_sheet_col_letter( $col_idx );
		if ( '' === $letter ) {
			continue;
		}
		$grid = vt_maint_sheet_fetch_column_grid_cells( $spreadsheet_id, $sheet_title, $letter, $row_max, $api_key );
		if ( empty( $grid['ok'] ) ) {
			continue;
		}
		$grid_rows = is_array( $grid['rows'] ) ? $grid['rows'] : [];
		foreach ( $grid_rows as $ridx => $r ) {
			if ( ! is_array( $r ) ) {
				continue;
			}
			// Each rowData has one cell in values[0] for this column.
			$cell = $r['values'][0] ?? null;
			if ( ! is_array( $cell ) ) {
				continue;
			}
			if ( ! isset( $rows[ $ridx ]['values'] ) || ! is_array( $rows[ $ridx ]['values'] ) ) {
				$rows[ $ridx ]['values'] = [];
			}
			$existing = isset( $rows[ $ridx ]['values'][ $col_idx ] ) && is_array( $rows[ $ridx ]['values'][ $col_idx ] ) ? $rows[ $ridx ]['values'][ $col_idx ] : [];
			// Preserve formattedValue from Values API, but inject hyperlink/textFormatRuns/formulaValue when present.
			$rows[ $ridx ]['values'][ $col_idx ] = array_merge( $existing, $cell );
		}
	}
}

function vt_maint_twitch_login_from_url( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return '';
	}
	if ( preg_match( '~twitch\.tv/([^/?#]+)~i', $url, $m ) ) {
		$login = strtolower( trim( (string) $m[1] ) );
		$blacklist = [ 'videos', 'directory', 'settings', 'p', 'downloads', 'about' ];
		if ( ! in_array( $login, $blacklist, true ) ) {
			return $login;
		}
	}
	return '';
}

function vt_maint_twitter_handle_from_url( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return '';
	}
	if ( preg_match( '~(?:x\\.com|twitter\\.com)/([^/?#]+)~i', $url, $m ) ) {
		$h = strtolower( trim( (string) $m[1] ) );
		$h = preg_replace( '/[^0-9a-z_]/i', '', $h );
		$blacklist = [ 'home', 'explore', 'search', 'i', 'intent', 'settings', 'login', 'share' ];
		if ( $h !== '' && ! in_array( $h, $blacklist, true ) ) {
			return $h;
		}
	}
	return '';
}

function vt_maint_twitch_app_token() {
	$cached = get_transient( 'vt_maint_twitch_app_token' );
	if ( '' !== trim( (string) $cached ) ) {
		return (string) $cached;
	}
	$client_id = defined( 'VT_TWITCH_CLIENT_ID' ) ? VT_TWITCH_CLIENT_ID : get_option( 'vt_twitch_client_id', '' );
	$secret    = defined( 'VT_TWITCH_CLIENT_SECRET' ) ? VT_TWITCH_CLIENT_SECRET : get_option( 'vt_twitch_client_secret', '' );
	$client_id = trim( (string) $client_id );
	$secret    = trim( (string) $secret );
	if ( '' === $client_id || '' === $secret ) {
		return '';
	}
	$res = wp_remote_post(
		'https://id.twitch.tv/oauth2/token',
		[
			'timeout' => 20,
			'body'    => [
				'client_id'     => $client_id,
				'client_secret' => $secret,
				'grant_type'    => 'client_credentials',
			],
		]
	);
	if ( is_wp_error( $res ) ) {
		return '';
	}
	$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
	$token = trim( (string) ( $data['access_token'] ?? '' ) );
	$ttl   = intval( $data['expires_in'] ?? 3600 );
	if ( '' !== $token ) {
		set_transient( 'vt_maint_twitch_app_token', $token, max( 300, $ttl - 120 ) );
	}
	return $token;
}

function vt_maint_fetch_twitch_meta( $twitch_url ) {
	$login = vt_maint_twitch_login_from_url( $twitch_url );
	if ( '' === $login ) {
		return [ 'status' => 'invalid_login' ];
	}
	$client_id = defined( 'VT_TWITCH_CLIENT_ID' ) ? VT_TWITCH_CLIENT_ID : get_option( 'vt_twitch_client_id', '' );
	$token     = vt_maint_twitch_app_token();
	if ( '' === trim( (string) $client_id ) || '' === trim( (string) $token ) ) {
		return [ 'status' => 'auth_missing' ];
	}
	$headers = [
		'Client-ID'     => trim( (string) $client_id ),
		'Authorization' => 'Bearer ' . trim( (string) $token ),
	];
	$user_res = wp_remote_get(
		add_query_arg( [ 'login' => $login ], 'https://api.twitch.tv/helix/users' ),
		[ 'timeout' => 20, 'headers' => $headers ]
	);
	if ( is_wp_error( $user_res ) ) {
		return [ 'status' => 'api_error' ];
	}
	$user_data = json_decode( (string) wp_remote_retrieve_body( $user_res ), true );
	$user      = $user_data['data'][0] ?? [];
	$user_id   = (string) ( $user['id'] ?? '' );
	if ( '' === $user_id ) {
		return [ 'status' => 'user_not_found' ];
	}

	$followers = 0;
	$f_res = wp_remote_get(
		add_query_arg( [ 'broadcaster_id' => $user_id ], 'https://api.twitch.tv/helix/channels/followers' ),
		[ 'timeout' => 20, 'headers' => $headers ]
	);
	$f_status = 'ok';
	if ( ! is_wp_error( $f_res ) ) {
		$f_data = json_decode( (string) wp_remote_retrieve_body( $f_res ), true );
		$followers = intval( $f_data['total'] ?? 0 );
	} else {
		$f_status = 'followers_api_error';
	}

	return [
		'followers' => $followers,
		'avatar'    => trim( (string) ( $user['profile_image_url'] ?? '' ) ),
		'summary'   => trim( (string) ( $user['description'] ?? '' ) ),
		'status'    => $f_status,
	];
}

function vt_maint_url_host_match( $url, $hosts ) {
	$host = (string) wp_parse_url( (string) $url, PHP_URL_HOST );
	$host = vt_maint_lower( preg_replace( '/^www\./i', '', $host ) );
	if ( '' === $host ) {
		return false;
	}
	foreach ( (array) $hosts as $h ) {
		$h = vt_maint_lower( preg_replace( '/^www\./i', '', (string) $h ) );
		if ( '' === $h ) {
			continue;
		}
		if ( $host === $h || ( strlen( $host ) > strlen( $h ) && vt_maint_ends_with( $host, '.' . $h ) ) ) {
			return true;
		}
	}
	return false;
}

function vt_maint_social_handle_from_url( $url, $hosts ) {
	if ( ! vt_maint_url_host_match( $url, $hosts ) ) {
		return '';
	}
	$path = (string) wp_parse_url( (string) $url, PHP_URL_PATH );
	$path = trim( $path, '/' );
	if ( '' === $path ) {
		return '';
	}
	$seg = explode( '/', $path );
	$h   = trim( (string) ( $seg[0] ?? '' ) );
	if ( '' === $h ) {
		return '';
	}
	if ( vt_maint_starts_with( $h, '@' ) ) {
		$h = substr( $h, 1 );
	}
	$block = [ 'home', 'intent', 'share', 'i', 'explore', 'search', 'hashtag', 'settings', 'messages', 'notifications', 'login' ];
	if ( in_array( vt_maint_lower( $h ), $block, true ) ) {
		return '';
	}
	return preg_match( '/^[A-Za-z0-9._-]{2,80}$/', $h ) ? $h : '';
}

function vt_maint_youtube_identity_from_url( $url ) {
	$url = vt_maint_clean_url( (string) $url );
	if ( '' === $url ) {
		return '';
	}
	$host = vt_maint_lower( (string) wp_parse_url( $url, PHP_URL_HOST ) );
	if ( '' === $host || ( false === strpos( $host, 'youtube.com' ) && false === strpos( $host, 'youtu.be' ) ) ) {
		return '';
	}
	$path = trim( (string) wp_parse_url( $url, PHP_URL_PATH ), '/' );
	if ( '' === $path ) {
		return '';
	}
	$seg = explode( '/', $path );
	$first = trim( (string) ( $seg[0] ?? '' ) );
	$second = trim( (string) ( $seg[1] ?? '' ) );
	if ( '' === $first ) {
		return '';
	}

	// /@channel_handle
	if ( vt_maint_starts_with( $first, '@' ) ) {
		$h = substr( $first, 1 );
		return preg_match( '/^[A-Za-z0-9._-]{2,120}$/', $h ) ? $h : '';
	}

	// /channel/UCxxxx , /c/name , /user/name
	if ( in_array( vt_maint_lower( $first ), [ 'channel', 'c', 'user' ], true ) && '' !== $second ) {
		return preg_match( '/^[A-Za-z0-9._-]{2,120}$/', $second ) ? $second : '';
	}

	// Avoid video/playlist routes.
	if ( in_array( vt_maint_lower( $first ), [ 'watch', 'shorts', 'playlist', 'live', 'embed' ], true ) ) {
		return '';
	}

	return preg_match( '/^[A-Za-z0-9._-]{2,120}$/', $first ) ? $first : '';
}

function vt_maint_social_avatar_candidates( $post_id ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return [];
	}

	$out = [];
	$add = function ( $label, $url ) use ( &$out ) {
		$url = vt_maint_clean_url( (string) $url );
		if ( '' === $url || vt_maint_is_placeholder_avatar_url( $url ) ) {
			return;
		}
		$key = $label . '|' . $url;
		if ( isset( $out[ $key ] ) ) {
			return;
		}
		$out[ $key ] = [ 'label' => (string) $label, 'url' => $url ];
	};

	$twitter = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_twitter_url', true ) );
	$twitter_og = vt_maint_fetch_og_image_url( $twitter );
	if ( '' !== $twitter_og ) {
		$add( 'twitter_og', $twitter_og );
	}
	$x_user  = vt_maint_social_handle_from_url( $twitter, [ 'x.com', 'twitter.com' ] );
	if ( '' !== $x_user ) {
		$add( 'twitter_unavatar', 'https://unavatar.io/twitter/' . rawurlencode( $x_user ) );
		$add( 'x_unavatar', 'https://unavatar.io/x/' . rawurlencode( $x_user ) );
	}

	$youtube = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_youtube_url', true ) );
	$yt_user = vt_maint_youtube_identity_from_url( $youtube );
	if ( '' !== $yt_user ) {
		$add( 'youtube_unavatar', 'https://unavatar.io/youtube/' . rawurlencode( $yt_user ) );
	}

	$twitch = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_twitch_url', true ) );
	$tw_user = vt_maint_twitch_login_from_url( $twitch );
	if ( '' !== $tw_user ) {
		$add( 'twitch_unavatar', 'https://unavatar.io/twitch/' . rawurlencode( $tw_user ) );
	}

	$instagram = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_instagram', true ) );
	$instagram_og = vt_maint_fetch_og_image_url( $instagram );
	if ( '' !== $instagram_og ) {
		$add( 'instagram_og', $instagram_og );
	}
	$ig_user   = vt_maint_social_handle_from_url( $instagram, [ 'instagram.com' ] );
	if ( '' !== $ig_user ) {
		$add( 'instagram_unavatar', 'https://unavatar.io/instagram/' . rawurlencode( $ig_user ) );
	}

	$facebook = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_facebook_url', true ) );
	$facebook_og = vt_maint_fetch_og_image_url( $facebook );
	if ( '' !== $facebook_og ) {
		$add( 'facebook_og', $facebook_og );
	}
	$fb_user  = vt_maint_social_handle_from_url( $facebook, [ 'facebook.com', 'fb.com' ] );
	if ( '' !== $fb_user ) {
		$add( 'facebook_unavatar', 'https://unavatar.io/facebook/' . rawurlencode( $fb_user ) );
	}

	$bluesky = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_bluesky_url', true ) );
	$bluesky_og = vt_maint_fetch_og_image_url( $bluesky );
	if ( '' !== $bluesky_og ) {
		$add( 'bluesky_og', $bluesky_og );
	}
	$bs_user = vt_maint_social_handle_from_url( $bluesky, [ 'bsky.app' ] );
	if ( '' !== $bs_user ) {
		$add( 'bluesky_unavatar', 'https://unavatar.io/' . rawurlencode( $bs_user ) . '.bsky.social' );
	}

	$email = sanitize_email( (string) get_post_meta( $post_id, 'vt_email', true ) );
	if ( '' !== $email ) {
		$hash = md5( strtolower( trim( $email ) ) );
		$add( 'gravatar', 'https://www.gravatar.com/avatar/' . $hash . '?s=400&d=404' );
	}

	$aff_url = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_affiliation_url', true ) );
	$aff_host = (string) wp_parse_url( $aff_url, PHP_URL_HOST );
	if ( '' !== trim( $aff_host ) ) {
		$aff_host = preg_replace( '/^www\./i', '', (string) $aff_host );
		$add( 'domain_unavatar', 'https://unavatar.io/' . $aff_host );
	}

	return array_values( $out );
}

function vt_maint_fetch_og_image_url( $url ) {
	$meta = vt_maint_fetch_og_profile_meta( $url );
	$img  = vt_maint_clean_url( (string) ( $meta['avatar'] ?? '' ) );
	return ( '' !== $img && ! vt_maint_is_placeholder_avatar_url( $img ) ) ? $img : '';
}

function vt_maint_summary_needs_enrich( $summary ) {
	$s = trim( wp_strip_all_tags( (string) $summary ) );
	$s = html_entity_decode( $s, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
	$s = trim( preg_replace( '/\s+/u', ' ', $s ) );
	if ( '' === $s ) {
		return true;
	}
	$len = function_exists( 'mb_strlen' ) ? intval( mb_strlen( $s, 'UTF-8' ) ) : strlen( $s );
	if ( $len < 12 ) {
		return true;
	}
	$sl = vt_maint_lower( $s );
	$bad_markers = [
		'資料更新中',
		'资料更新中',
		'no description',
		'description unavailable',
		'account suspended',
		'this account doesn',
		'this channel doesn',
		'coming soon',
		'無此帳號',
	];
	foreach ( $bad_markers as $mk ) {
		if ( '' !== $mk && false !== strpos( $sl, vt_maint_lower( (string) $mk ) ) ) {
			return true;
		}
	}
	return false;
}

function vt_maint_fetch_og_profile_meta( $url ) {
	$url = vt_maint_clean_url( (string) $url );
	if ( '' === $url ) {
		return [];
	}
	$cache_key = 'vt_maint_og_meta_' . md5( $url );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) ) {
		return $cached;
	}
	$res = wp_remote_get(
		$url,
		[
			'timeout'     => 14,
			'redirection' => 4,
			'headers'     => [
				'User-Agent'      => 'vt-maint/1.4 (+usadanews.com)',
				'Accept-Language' => 'zh-TW,zh;q=0.9,en;q=0.7',
			],
		]
	);
	if ( is_wp_error( $res ) ) {
		set_transient( $cache_key, [], HOUR_IN_SECONDS );
		return [];
	}
	$html = (string) wp_remote_retrieve_body( $res );
	if ( '' === trim( $html ) ) {
		set_transient( $cache_key, [], HOUR_IN_SECONDS );
		return [];
	}

	$pick_meta_content = static function ( $html_text, $keys ) {
		foreach ( (array) $keys as $k ) {
			$k = preg_quote( (string) $k, '/' );
			$patterns = [
				'/<meta[^>]+(?:property|name)=["\']' . $k . '["\'][^>]*content=["\']([^"\']+)["\']/i',
				'/<meta[^>]*content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' . $k . '["\']/i',
			];
			foreach ( $patterns as $re ) {
				if ( preg_match( $re, $html_text, $m ) ) {
					$v = trim( (string) ( $m[1] ?? '' ) );
					if ( '' !== $v ) {
						return $v;
					}
				}
			}
		}
		return '';
	};

	$desc_raw = $pick_meta_content( $html, [ 'og:description', 'twitter:description', 'description' ] );
	$img_raw  = $pick_meta_content( $html, [ 'og:image', 'twitter:image', 'twitter:image:src' ] );
	$desc = trim( wp_strip_all_tags( html_entity_decode( (string) $desc_raw, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ) );
	$desc = trim( preg_replace( '/\s+/u', ' ', $desc ) );
	$img  = vt_maint_clean_url( (string) $img_raw );
	if ( '' !== $img && vt_maint_is_placeholder_avatar_url( $img ) ) {
		$img = '';
	}

	$out = [];
	if ( '' !== $desc ) {
		$out['description'] = $desc;
	}
	if ( '' !== $img ) {
		$out['avatar'] = $img;
	}
	set_transient( $cache_key, $out, ! empty( $out ) ? DAY_IN_SECONDS : HOUR_IN_SECONDS );
	return $out;
}

function vt_maint_mb_substr( $s, $max_chars ) {
	$s = (string) $s;
	$max_chars = intval( $max_chars );
	if ( $max_chars <= 0 ) {
		return '';
	}
	if ( function_exists( 'mb_substr' ) ) {
		return mb_substr( $s, 0, $max_chars, 'UTF-8' );
	}
	return substr( $s, 0, $max_chars );
}

function vt_maint_mb_stripos_safe( $haystack, $needle ) {
	$haystack = (string) $haystack;
	$needle   = (string) $needle;
	if ( '' === $needle ) {
		return false;
	}
	if ( function_exists( 'mb_stripos' ) ) {
		return mb_stripos( $haystack, $needle, 0, 'UTF-8' );
	}
	return stripos( $haystack, $needle );
}

function vt_maint_mb_strlen_safe( $s ) {
	$s = (string) $s;
	if ( function_exists( 'mb_strlen' ) ) {
		return intval( mb_strlen( $s, 'UTF-8' ) );
	}
	return intval( strlen( $s ) );
}

function vt_maint_internal_links_alias_candidates( $post_id ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return [];
	}
	$out   = [];
	$names = [];

	$title = get_the_title( $post_id );
	if ( is_string( $title ) && '' !== trim( $title ) ) {
		$names[] = trim( $title );
	}
	$display = function_exists( 'get_field' ) ? get_field( 'vt_display_name', $post_id ) : get_post_meta( $post_id, 'vt_display_name', true );
	if ( is_string( $display ) && '' !== trim( $display ) ) {
		$names[] = trim( $display );
	}

	$stop_alias = [
		'vtuber', 'youtube', 'twitch', 'twitter', 'x', 'channel', 'official', 'ch',
	];

	foreach ( array_values( array_unique( array_filter( array_map( 'strval', $names ) ) ) ) as $name ) {
		$name = trim( wp_strip_all_tags( $name ) );
		if ( '' === $name ) {
			continue;
		}
		$variants   = [ $name ];
		$parts_slash = preg_split( '/\s*[/|｜]\s*/u', $name );
		if ( is_array( $parts_slash ) ) {
			foreach ( $parts_slash as $part ) {
				$part = trim( (string) $part );
				if ( '' !== $part ) {
					$variants[] = $part;
				}
			}
		}
		foreach ( $variants as $alias ) {
			$alias = trim( (string) $alias );
			if ( '' === $alias ) {
				continue;
			}
			$alias = preg_replace( '/\s+/u', ' ', $alias );
			$alias = trim( (string) $alias );
			if ( '' === $alias ) {
				continue;
			}

			$clean = preg_replace( '/\b(channel|official|ch\.?)\b/iu', '', $alias );
			$clean = trim( preg_replace( '/\s+/u', ' ', (string) $clean ), " \t\n\r\0\x0B-_.:|/" );
			if ( '' !== $clean && $clean !== $alias ) {
				$variants[] = $clean;
			}
		}

		$variants = array_values( array_unique( array_map( 'strval', $variants ) ) );
		foreach ( $variants as $alias ) {
			$alias = trim( (string) $alias );
			if ( '' === $alias ) {
				continue;
			}
			$lower = vt_maint_lower( $alias );
			if ( in_array( $lower, $stop_alias, true ) ) {
				continue;
			}
			$has_cjk = (bool) preg_match( '/[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]/u', $alias );
			$len     = vt_maint_mb_strlen_safe( $alias );
			if ( $has_cjk && $len < 2 ) {
				continue;
			}
			if ( ! $has_cjk && $len < 4 ) {
				continue;
			}
			if ( preg_match( '/^\d+$/', $alias ) ) {
				continue;
			}
			$out[] = $alias;
		}
	}

	return array_values( array_unique( $out ) );
}

function vt_maint_internal_links_build_alias_index() {
	$all_ids = get_posts(
		[
			'post_type'              => 'vtuber',
			'post_status'            => 'publish',
			'fields'                 => 'ids',
			'posts_per_page'         => -1,
			'orderby'                => 'ID',
			'order'                  => 'ASC',
			'no_found_rows'          => true,
			'update_post_meta_cache' => false,
			'update_post_term_cache' => false,
		]
	);
	$rows = [];
	$seen = [];
	foreach ( (array) $all_ids as $pid ) {
		$pid = intval( $pid );
		if ( $pid <= 0 ) {
			continue;
		}
		$aliases = vt_maint_internal_links_alias_candidates( $pid );
		foreach ( $aliases as $alias ) {
			$key = vt_maint_title_key( $alias );
			if ( '' === $key ) {
				continue;
			}
			$sig = $key . '::' . $pid;
			if ( isset( $seen[ $sig ] ) ) {
				continue;
			}
			$seen[ $sig ] = true;
			$rows[]       = [
				'post_id'  => $pid,
				'alias'    => $alias,
				'is_latin' => ! preg_match( '/[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]/u', $alias ),
				'len'      => vt_maint_mb_strlen_safe( $alias ),
			];
		}
	}
	usort(
		$rows,
		static function ( $a, $b ) {
			$la = intval( $a['len'] ?? 0 );
			$lb = intval( $b['len'] ?? 0 );
			if ( $la !== $lb ) {
				return $lb <=> $la;
			}
			return intval( $a['post_id'] ?? 0 ) <=> intval( $b['post_id'] ?? 0 );
		}
	);
	return $rows;
}

function vt_maint_internal_links_pattern( $alias, $is_latin ) {
	$alias = trim( (string) $alias );
	if ( '' === $alias ) {
		return '';
	}
	$q = preg_quote( $alias, '/' );
	if ( $is_latin ) {
		return '/(?<![A-Za-z0-9_])' . $q . '(?![A-Za-z0-9_])/iu';
	}
	return '/' . $q . '/u';
}

function vt_maint_internal_links_find_mentions( $text, $source_post_id, $source_lang, $alias_index, $max_links = 4 ) {
	$text           = (string) $text;
	$source_post_id = intval( $source_post_id );
	$source_lang    = sanitize_title( (string) $source_lang );
	$max_links      = max( 1, intval( $max_links ) );
	$out            = [];
	$used_ranges    = [];
	$used_targets   = [];

	foreach ( (array) $alias_index as $row ) {
		if ( count( $out ) >= $max_links ) {
			break;
		}
		$target_post_id = intval( $row['post_id'] ?? 0 );
		if ( $target_post_id <= 0 || $target_post_id === $source_post_id ) {
			continue;
		}
		if ( isset( $used_targets[ $target_post_id ] ) ) {
			continue;
		}
		$alias   = trim( (string) ( $row['alias'] ?? '' ) );
		$pattern = vt_maint_internal_links_pattern( $alias, ! empty( $row['is_latin'] ) );
		if ( '' === $alias || '' === $pattern ) {
			continue;
		}
		$m = [];
		if ( ! preg_match( $pattern, $text, $m, PREG_OFFSET_CAPTURE ) ) {
			continue;
		}
		$label = (string) ( $m[0][0] ?? '' );
		$start = intval( $m[0][1] ?? -1 );
		$len   = strlen( $label );
		if ( '' === $label || $start < 0 || $len <= 0 ) {
			continue;
		}

		$overlap = false;
		foreach ( $used_ranges as $rg ) {
			$rs = intval( $rg['start'] ?? 0 );
			$re = intval( $rg['end'] ?? 0 );
			if ( $start < $re && ( $start + $len ) > $rs ) {
				$overlap = true;
				break;
			}
		}
		if ( $overlap ) {
			continue;
		}

		$target_lang_post = $target_post_id;
		if ( '' !== $source_lang && function_exists( 'pll_get_post' ) ) {
			$translated = intval( pll_get_post( $target_post_id, $source_lang ) );
			if ( $translated > 0 ) {
				$target_lang_post = $translated;
			}
		}
		if ( $target_lang_post === $source_post_id ) {
			continue;
		}
		$url = get_permalink( $target_lang_post );
		if ( ! is_string( $url ) || '' === trim( $url ) ) {
			continue;
		}

		$out[] = [
			'start'          => $start,
			'len'            => $len,
			'label'          => $label,
			'alias'          => $alias,
			'target_post_id' => $target_lang_post,
			'url'            => $url,
		];
		$used_ranges[]              = [ 'start' => $start, 'end' => $start + $len ];
		$used_targets[ $target_post_id ] = true;
	}

	usort(
		$out,
		static function ( $a, $b ) {
			return intval( $a['start'] ?? 0 ) <=> intval( $b['start'] ?? 0 );
		}
	);
	return $out;
}

function vt_maint_internal_links_render_html( $text, $mentions ) {
	$text   = (string) $text;
	$cursor = 0;
	$out    = '';
	foreach ( (array) $mentions as $m ) {
		$start = intval( $m['start'] ?? -1 );
		$len   = intval( $m['len'] ?? 0 );
		$url   = (string) ( $m['url'] ?? '' );
		if ( $start < 0 || $len <= 0 || '' === $url ) {
			continue;
		}
		if ( $start < $cursor ) {
			continue;
		}
		$out .= esc_html( substr( $text, $cursor, $start - $cursor ) );
		$label = substr( $text, $start, $len );
		$out  .= '<a class="vt-auto-link" href="' . esc_url( $url ) . '">' . esc_html( $label ) . '</a>';
		$cursor = $start + $len;
	}
	$out .= esc_html( substr( $text, $cursor ) );
	return wpautop( $out );
}

function vt_maint_internal_links_run( $batch = 80, $force = 0 ) {
	$lock_key = 'vt_maint_internal_links_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 3600 ) ) {
		return [ 'ok' => false, 'reason' => 'locked' ];
	}

	try {
		$batch = max( 10, min( 200, intval( $batch ) ) );
		$force = intval( $force );
		$cursor_key = 'vt_maint_internal_links_cursor';
		$cursor     = max( 0, intval( get_option( $cursor_key, 0 ) ) );

		$ids = [];
		if ( $force > 0 && 'vtuber' === get_post_type( $force ) ) {
			$ids = [ $force ];
		} else {
			global $wpdb;
			$ids = $wpdb->get_col(
				$wpdb->prepare(
					"SELECT ID FROM {$wpdb->posts} WHERE post_type=%s AND post_status='publish' AND ID > %d ORDER BY ID ASC LIMIT %d",
					'vtuber',
					$cursor,
					$batch
				)
			);
			$ids = array_values( array_map( 'intval', (array) $ids ) );
			if ( empty( $ids ) && $cursor > 0 ) {
				update_option( $cursor_key, 0, false );
				$cursor = 0;
				$ids    = $wpdb->get_col(
					$wpdb->prepare(
						"SELECT ID FROM {$wpdb->posts} WHERE post_type=%s AND post_status='publish' ORDER BY ID ASC LIMIT %d",
						'vtuber',
						$batch
					)
				);
				$ids = array_values( array_map( 'intval', (array) $ids ) );
			}
		}

		$alias_index = vt_maint_internal_links_build_alias_index();
		$checked     = 0;
		$updated     = 0;
		$linked      = 0;
		$links_total = 0;
		$updated_ids = [];
		$linked_ids  = [];
		$errors      = [];

		foreach ( $ids as $post_id ) {
			$post_id = intval( $post_id );
			if ( $post_id <= 0 ) {
				continue;
			}
			$checked++;
			$summary = function_exists( 'get_field' ) ? get_field( 'vt_summary', $post_id ) : get_post_meta( $post_id, 'vt_summary', true );
			if ( ! is_string( $summary ) || '' === trim( $summary ) ) {
				$summary = (string) get_post_field( 'post_excerpt', $post_id );
			}
			$summary = trim( wp_strip_all_tags( (string) $summary ) );

			$prev_html = (string) get_post_meta( $post_id, 'vt_summary_html', true );
			$prev_json = (string) get_post_meta( $post_id, 'vt_internal_links_json', true );

			if ( '' === $summary ) {
				$changed = false;
				if ( '' !== $prev_html ) {
					delete_post_meta( $post_id, 'vt_summary_html' );
					$changed = true;
				}
				if ( '' !== $prev_json ) {
					delete_post_meta( $post_id, 'vt_internal_links_json' );
					$changed = true;
				}
				if ( $changed ) {
					$updated++;
					if ( count( $updated_ids ) < 40 ) {
						$updated_ids[] = $post_id;
					}
				}
				continue;
			}

			$lang = function_exists( 'pll_get_post_language' ) ? (string) pll_get_post_language( $post_id, 'slug' ) : '';
			$mentions = vt_maint_internal_links_find_mentions( $summary, $post_id, $lang, $alias_index, 4 );

			if ( empty( $mentions ) ) {
				$changed = false;
				if ( '' !== $prev_html ) {
					delete_post_meta( $post_id, 'vt_summary_html' );
					$changed = true;
				}
				if ( '' !== $prev_json ) {
					delete_post_meta( $post_id, 'vt_internal_links_json' );
					$changed = true;
				}
				if ( $changed ) {
					$updated++;
					if ( count( $updated_ids ) < 40 ) {
						$updated_ids[] = $post_id;
					}
				}
				continue;
			}

			$html = vt_maint_internal_links_render_html( $summary, $mentions );
			$json_rows = [];
			foreach ( $mentions as $m ) {
				$json_rows[] = [
					'label'          => (string) ( $m['label'] ?? '' ),
					'alias'          => (string) ( $m['alias'] ?? '' ),
					'target_post_id' => intval( $m['target_post_id'] ?? 0 ),
					'url'            => (string) ( $m['url'] ?? '' ),
				];
			}
			$json = wp_json_encode( $json_rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES );

			$changed = false;
			if ( $prev_html !== $html ) {
				update_post_meta( $post_id, 'vt_summary_html', $html );
				$changed = true;
			}
			if ( $prev_json !== $json ) {
				update_post_meta( $post_id, 'vt_internal_links_json', $json );
				$changed = true;
			}
			update_post_meta( $post_id, 'vt_internal_links_synced_at', gmdate( 'c' ) );

			if ( $changed ) {
				$updated++;
				if ( count( $updated_ids ) < 40 ) {
					$updated_ids[] = $post_id;
				}
			}
			$linked++;
			if ( count( $linked_ids ) < 40 ) {
				$linked_ids[] = $post_id;
			}
			$links_total += count( $mentions );
		}

		$next_cursor = 0;
		if ( $force <= 0 && ! empty( $ids ) ) {
			$last_id = intval( end( $ids ) );
			$next_cursor = count( $ids ) < $batch ? 0 : $last_id;
			update_option( $cursor_key, $next_cursor, false );
		}

		$report = [
			'ok'            => true,
			'utc'           => gmdate( 'c' ),
			'batch'         => $batch,
			'force'         => $force,
			'checked'       => $checked,
			'updated'       => $updated,
			'linked_posts'  => $linked,
			'links_total'   => $links_total,
			'updated_post_ids' => array_values( array_unique( array_map( 'intval', $updated_ids ) ) ),
			'linked_post_ids'  => array_values( array_unique( array_map( 'intval', $linked_ids ) ) ),
			'aliases_total' => count( $alias_index ),
			'cursor_before' => $cursor,
			'cursor_after'  => $next_cursor,
			'errors'        => $errors,
		];
		vt_maint_write_log_json( 'internal-links-last.json', $report );
		vt_maint_log(
			'internal_links checked=' . intval( $checked ) .
			' updated=' . intval( $updated ) .
			' linked_posts=' . intval( $linked ) .
			' links=' . intval( $links_total ) .
			' cursor=' . intval( $next_cursor )
		);
		return $report;
	} catch ( Throwable $e ) {
		$report = [
			'ok'      => false,
			'utc'     => gmdate( 'c' ),
			'error'   => $e->getMessage(),
			'trace'   => substr( $e->getTraceAsString(), 0, 1600 ),
			'updated' => 0,
		];
		vt_maint_write_log_json( 'internal-links-last.json', $report );
		vt_maint_log( 'internal_links fatal=' . $e->getMessage() );
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_moegirl_api_base() {
	return 'https://zh.moegirl.org.cn/api.php';
}

function vt_maint_moegirl_api_get( $params, $timeout = 18 ) {
	$params = is_array( $params ) ? $params : [];
	$params['format'] = 'json';
	$url = add_query_arg( $params, vt_maint_moegirl_api_base() );
	$cache_key = 'vt_moegirl_' . md5( $url );
	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) ) {
		return $cached;
	}
	$res = wp_remote_get(
		$url,
		[
			'timeout'     => max( 8, intval( $timeout ) ),
			'redirection' => 2,
			'headers'     => [
				'User-Agent'      => 'vt-maint/1.3 (+usadanews.com)',
				'Accept-Language' => 'zh-TW,zh;q=0.9,en;q=0.7',
			],
		]
	);
	if ( is_wp_error( $res ) ) {
		set_transient( $cache_key, [], 10 * MINUTE_IN_SECONDS );
		return [];
	}
	$body = (string) wp_remote_retrieve_body( $res );
	$data = json_decode( $body, true );
	if ( ! is_array( $data ) ) {
		set_transient( $cache_key, [], 10 * MINUTE_IN_SECONDS );
		return [];
	}
	set_transient( $cache_key, $data, 12 * HOUR_IN_SECONDS );
	return $data;
}

function vt_maint_moegirl_opensearch_first( $query ) {
	$q = trim( (string) $query );
	if ( '' === $q ) {
		return [];
	}
	$data = vt_maint_moegirl_api_get(
		[
			'action'    => 'opensearch',
			'search'    => $q,
			'limit'     => 3,
			'namespace' => 0,
		],
		16
	);
	$titles = is_array( $data[1] ?? null ) ? $data[1] : [];
	$urls   = is_array( $data[3] ?? null ) ? $data[3] : [];
	$t0 = trim( (string) ( $titles[0] ?? '' ) );
	$u0 = trim( (string) ( $urls[0] ?? '' ) );
	if ( '' === $t0 ) {
		return [];
	}
	return [
		'title' => $t0,
		'url'   => vt_maint_clean_url( $u0 ),
	];
}

function vt_maint_moegirl_extract_intro( $title ) {
	$title = trim( (string) $title );
	if ( '' === $title ) {
		return '';
	}
	$data = vt_maint_moegirl_api_get(
		[
			'action'      => 'query',
			'prop'        => 'extracts',
			'exintro'     => 1,
			'explaintext' => 1,
			'redirects'   => 1,
			'titles'      => $title,
		],
		18
	);
	$pages = $data['query']['pages'] ?? [];
	if ( ! is_array( $pages ) ) {
		return '';
	}
	$page = null;
	foreach ( $pages as $p ) {
		$page = $p;
		break;
	}
	if ( ! is_array( $page ) ) {
		return '';
	}
	return trim( (string) ( $page['extract'] ?? '' ) );
}

function vt_maint_moegirl_clean_extract( $s ) {
	$s = (string) $s;
	if ( '' === trim( $s ) ) {
		return '';
	}
	$lines = preg_split( '/\r?\n/', $s );
	$out = [];
	foreach ( (array) $lines as $ln ) {
		$ln = trim( (string) $ln );
		if ( '' === $ln ) {
			continue;
		}
		if ( preg_match( '/^(File|Image|??|??)\s*:/iu', $ln ) ) {
			continue;
		}
		$ln = preg_replace( '/\[[0-9]+\]/', '', $ln );
		$ln = preg_replace( '/\s+/', ' ', $ln );
		$out[] = $ln;
	}
	$s = trim( implode( "\n", $out ) );
	$s = preg_replace( '/^.*??/', '', $s );
	return trim( (string) $s );
}

function vt_maint_moegirl_build_summary( $display_name, $extract, $moegirl_title ) {
	$display_name = trim( (string) $display_name );
	$extract = vt_maint_moegirl_clean_extract( (string) $extract );
	$moegirl_title = trim( (string) $moegirl_title );
	if ( '' === $display_name ) {
		$display_name = $moegirl_title;
	}
	if ( '' === $display_name || '' === $extract ) {
		return '';
	}

	$jp_name = '';
	$en_name = '';
	$debut   = '';
	$platform = '';
	$aff = '';

	if ( preg_match( '/??\s*[:?]\s*([^?\n]{2,160})/u', $extract, $m ) ) {
		$jp_name = trim( (string) $m[1] );
	}
	if ( preg_match( '/\b([A-Z][A-Za-z0-9 .\-]{2,80})\b/', $extract, $m ) ) {
		$en_name = trim( (string) $m[1] );
	}
	if ( preg_match( '/(\d{4})\s*?\s*(\d{1,2})\s*?\s*(\d{1,2})\s*?/u', $extract, $m ) ) {
		$debut = sprintf( '%04d-%02d-%02d', intval( $m[1] ), intval( $m[2] ), intval( $m[3] ) );
	}
	if ( false !== stripos( $extract, 'YouTube' ) ) {
		$platform = 'YouTube';
	} elseif ( false !== stripos( $extract, 'Twitch' ) ) {
		$platform = 'Twitch';
	}
	if ( preg_match( '/\b(hololive|nijisanji|VShojo|Phase-Connect|voms)\b/i', $extract, $m ) ) {
		$aff = (string) $m[1];
	}

	$names = [];
	if ( '' !== $jp_name ) {
		$names[] = $jp_name;
	}
	if ( '' !== $en_name && $en_name !== $jp_name && $en_name !== $display_name ) {
		$names[] = $en_name;
	}
	$name_part = '';
	if ( ! empty( $names ) ) {
		$name_part = '?' . implode( ' / ', array_slice( $names, 0, 2 ) ) . '?';
	}

	$bits = [];
	$bits[] = $display_name . $name_part . '? VTuber?';
	$whenwhere = [];
	if ( '' !== $debut ) {
		$whenwhere[] = $debut;
	}
	if ( '' !== $platform ) {
		$whenwhere[] = '? ' . $platform . ' ??';
	}
	if ( ! empty( $whenwhere ) ) {
		$bits[] = implode( '?', $whenwhere ) . '?';
	}
	if ( '' !== $aff ) {
		$bits[] = '????????' . $aff . '?';
	}

	$out = trim( implode( ' ', $bits ) );
	$out = vt_maint_mb_substr( $out, 360 );
	return trim( $out );
}

function vt_maint_moegirl_pick_query_from_name( $name ) {
	$name = trim( (string) $name );
	if ( '' === $name ) {
		return '';
	}
	$stop = [
		'個人勢', '个人势', '企業勢', '企业势', '社團勢', '社团势',
		'活動中', '活动中', '休止中', '畢業', '毕业', '引退', '封存', '準備中', '准备中',
		'官方', '頻道', '频道', '主播', '勢', '轉生', '转生', '前世', '非正式', '出道',
	];
	if ( preg_match_all( '/[\p{Han}]{2,}/u', $name, $m ) ) {
		$best = '';
		foreach ( (array) ( $m[0] ?? [] ) as $tok ) {
			$tok = trim( (string) $tok );
			if ( '' === $tok ) {
				continue;
			}
			if ( in_array( $tok, $stop, true ) ) {
				continue;
			}
			if ( strlen( $tok ) > strlen( $best ) ) {
				$best = $tok;
			}
		}
		if ( '' !== $best ) {
			return $best;
		}
	}
	$name = str_replace( $stop, ' ', $name );
	$name = preg_replace( '/\b(ch\.?|channel)\b/i', '', $name );
	$name = trim( preg_replace( '/\s+/', ' ', $name ) );
	return $name;
}

function vt_maint_moegirl_pick_query_from_slug( $slug ) {
	$slug = trim( (string) $slug );
	if ( '' === $slug ) {
		return '';
	}
	$slug = rawurldecode( $slug );
	$slug = str_replace( [ '-', '_' ], ' ', $slug );
	$slug = preg_replace( '/\b(vtuber|official|channel|ch)\b/i', ' ', $slug );
	$slug = trim( preg_replace( '/\s+/', ' ', $slug ) );
	if ( '' === $slug ) {
		return '';
	}
	if ( preg_match_all( '/[\p{Han}\p{Hiragana}\p{Katakana}]{2,}/u', $slug, $m ) ) {
		$best = '';
		foreach ( (array) ( $m[0] ?? [] ) as $tok ) {
			$tok = trim( (string) $tok );
			if ( '' === $tok ) {
				continue;
			}
			if ( strlen( $tok ) > strlen( $best ) ) {
				$best = $tok;
			}
		}
		if ( '' !== $best ) {
			return $best;
		}
	}
	if ( preg_match_all( '/[A-Za-z][A-Za-z0-9]+/u', $slug, $m2 ) ) {
		$parts = array_slice( (array) ( $m2[0] ?? [] ), 0, 2 );
		$q = trim( implode( ' ', $parts ) );
		if ( '' !== $q ) {
			return $q;
		}
	}
	return $slug;
}

function vt_maint_moegirl_is_probable_match( $name, $q, $mg_title, $extract ) {
	$name = trim( (string) $name );
	$q = trim( (string) $q );
	$mg_title = trim( (string) $mg_title );
	$extract = trim( (string) $extract );
	if ( '' === $mg_title ) {
		return false;
	}
	$q_len = function_exists( 'mb_strlen' ) ? intval( mb_strlen( $q, 'UTF-8' ) ) : strlen( $q );
	$q_in_title = ( '' !== $q && false !== vt_maint_mb_stripos_safe( $mg_title, $q ) );
	$q_in_extract = ( '' !== $q && '' !== $extract && false !== vt_maint_mb_stripos_safe( $extract, $q ) );
	if ( $q_in_title && ( $q_len >= 3 || $q_in_extract ) ) {
		return true;
	}
	if ( preg_match_all( '/[\p{Han}]{2,}/u', $name, $m ) ) {
		foreach ( (array) ( $m[0] ?? [] ) as $tok ) {
			$tok = trim( (string) $tok );
			if ( '' === $tok ) {
				continue;
			}
			$t_len = function_exists( 'mb_strlen' ) ? intval( mb_strlen( $tok, 'UTF-8' ) ) : strlen( $tok );
			$t_in_title = ( false !== vt_maint_mb_stripos_safe( $mg_title, $tok ) );
			$t_in_extract = ( '' !== $extract && false !== vt_maint_mb_stripos_safe( $extract, $tok ) );
			if ( $t_in_title && ( $t_len >= 3 || $t_in_extract ) ) {
				return true;
			}
		}
	}
	return false;
}

function vt_maint_enrich_moegirl_run( $batch = 20, $force = 0 ) {
	global $wpdb;
	$batch = max( 1, min( 40, intval( $batch ) ) );
	$force = intval( $force ) ? 1 : 0;
	$cooldown_before = time() - ( 3 * DAY_IN_SECONDS );

	$sql = $wpdb->prepare(
		"\n		SELECT p.ID, p.post_title,\n			COALESCE(m_disp.meta_value, '') AS disp\n		FROM {$wpdb->posts} p\n		LEFT JOIN {$wpdb->postmeta} m_disp ON (m_disp.post_id = p.ID AND m_disp.meta_key = 'vt_display_name')\n		LEFT JOIN {$wpdb->postmeta} m_sum  ON (m_sum.post_id  = p.ID AND m_sum.meta_key  = 'vt_summary')\n		LEFT JOIN {$wpdb->postmeta} m_try  ON (m_try.post_id  = p.ID AND m_try.meta_key  = 'vt_moegirl_last_try')\n		WHERE p.post_type = 'vtuber'\n		AND p.post_status = 'publish'\n		AND (m_sum.meta_value IS NULL OR TRIM(m_sum.meta_value) = '')\n		AND (m_try.meta_value IS NULL OR CAST(m_try.meta_value AS UNSIGNED) < %d)\n		ORDER BY p.ID DESC\n		LIMIT %d\n		",
		$cooldown_before,
		$batch
	);
	$rows = $wpdb->get_results( $sql, ARRAY_A );

	$processed = 0;
	$updated = 0;
	$skipped = 0;
	$errors = 0;
	$no_query = 0;
	$no_hit = 0;
	$no_summary = 0;
	$debug = [];

	foreach ( (array) $rows as $r ) {
		$pid = intval( $r['ID'] ?? 0 );
		if ( $pid <= 0 ) {
			continue;
		}
		$processed++;
		$disp = trim( (string) ( $r['disp'] ?? '' ) );
		$title = trim( (string) ( $r['post_title'] ?? '' ) );
		$name = '' !== $disp ? $disp : $title;
		$q_name = vt_maint_moegirl_pick_query_from_name( $name );
		$q_slug = vt_maint_moegirl_pick_query_from_slug( (string) get_post_field( 'post_name', $pid ) );
		$q_candidates = array_values( array_filter( array_unique( [ $q_name, $q_slug ] ) ) );
		if ( empty( $q_candidates ) ) {
			$skipped++;
			$no_query++;
			update_post_meta( $pid, 'vt_moegirl_last_try', time() );
			if ( count( $debug ) < 10 ) {
				$debug[] = [ 'id' => $pid, 'name' => $name, 'q' => '', 'reason' => 'empty_query' ];
			}
			continue;
		}
		$q = '';
		$mg_title = '';
		$mg_url = '';
		$extract = '';
		$tried = [];
		foreach ( $q_candidates as $q_try ) {
			$q_try = trim( (string) $q_try );
			if ( '' === $q_try ) {
				continue;
			}
			$tried[] = $q_try;
			$hit = vt_maint_moegirl_opensearch_first( $q_try );
			$try_title = trim( (string) ( $hit['title'] ?? '' ) );
			if ( '' === $try_title ) {
				continue;
			}
			$try_extract = vt_maint_moegirl_extract_intro( $try_title );
			if ( ! vt_maint_moegirl_is_probable_match( $name, $q_try, $try_title, $try_extract ) ) {
				continue;
			}
			$q = $q_try;
			$mg_title = $try_title;
			$mg_url = vt_maint_clean_url( (string) ( $hit['url'] ?? '' ) );
			$extract = $try_extract;
			break;
		}
		if ( '' === $mg_title ) {
			$skipped++;
			$no_hit++;
			update_post_meta( $pid, 'vt_moegirl_last_try', time() );
			if ( count( $debug ) < 10 ) {
				$debug[] = [ 'id' => $pid, 'name' => $name, 'q' => implode( '|', $tried ), 'reason' => 'no_hit' ];
			}
			continue;
		}
		$summary = vt_maint_moegirl_build_summary( $name, $extract, $mg_title );
		if ( '' === $summary && '' !== $mg_title ) {
			$summary = trim( $name ) . '：可參考萌娘百科條目《' . $mg_title . '》了解更多公開資訊。';
			$summary = vt_maint_mb_substr( $summary, 180 );
		}
		if ( '' === $summary ) {
			$errors++;
			$no_summary++;
			update_post_meta( $pid, 'vt_moegirl_last_try', time() );
			if ( count( $debug ) < 10 ) {
				$debug[] = [ 'id' => $pid, 'name' => $name, 'q' => $q, 'moegirl' => $mg_title, 'reason' => 'empty_summary' ];
			}
			continue;
		}

		if ( ! $force && '' !== trim( (string) get_post_meta( $pid, 'vt_summary', true ) ) ) {
			$skipped++;
			update_post_meta( $pid, 'vt_moegirl_last_try', time() );
			continue;
		}

		update_post_meta( $pid, 'vt_summary', $summary );
		update_post_meta( $pid, 'vt_moegirl_title', $mg_title );
		update_post_meta( $pid, 'vt_moegirl_query', $q );
		if ( '' !== $mg_url ) {
			update_post_meta( $pid, 'vt_moegirl_url', $mg_url );
		}
		update_post_meta( $pid, 'vt_moegirl_last_try', time() );
		update_post_meta( $pid, 'vt_moegirl_synced_utc', gmdate( 'c' ) );
		$updated++;
		if ( count( $debug ) < 10 ) {
			$debug[] = [ 'id' => $pid, 'name' => $name, 'q' => $q, 'moegirl' => $mg_title, 'reason' => 'updated' ];
		}
	}

	return [
		'ok'        => 1,
		'processed' => $processed,
		'updated'   => $updated,
		'skipped'   => $skipped,
		'errors'    => $errors,
		'no_query'  => $no_query,
		'no_hit'    => $no_hit,
		'no_summary'=> $no_summary,
		'debug'     => $debug,
	];
}

function vt_maint_summary_is_weak_text( $summary, $min_len = 90 ) {
	$summary = trim( (string) $summary );
	$min_len = max( 20, intval( $min_len ) );
	if ( '' === $summary ) {
		return true;
	}
	$len = function_exists( 'mb_strlen' ) ? intval( mb_strlen( $summary, 'UTF-8' ) ) : strlen( $summary );
	if ( $len < $min_len ) {
		return true;
	}
	if ( preg_match( '/(資料更新中|无此账号|無此帳號|tbd|to be announced|coming soon|暫無|暂无|敬請期待|待補|待更新)/iu', $summary ) ) {
		return true;
	}
	return false;
}

function vt_maint_parse_ids_csv( $raw, $limit = 300 ) {
	$limit = max( 1, min( 1000, intval( $limit ) ) );
	$raw   = trim( (string) $raw );
	if ( '' === $raw ) {
		return [];
	}
	$parts = preg_split( '/[,\s;|]+/', $raw );
	$out = [];
	foreach ( (array) $parts as $p ) {
		$id = intval( $p );
		if ( $id <= 0 ) {
			continue;
		}
		$out[ $id ] = $id;
		if ( count( $out ) >= $limit ) {
			break;
		}
	}
	return array_values( $out );
}

function vt_maint_enrich_moegirl_ids_run( $ids, $force = 0, $min_len = 90 ) {
	$ids   = array_values( array_filter( array_map( 'intval', (array) $ids ) ) );
	$ids   = array_slice( array_unique( $ids ), 0, 300 );
	$force = intval( $force ) ? 1 : 0;
	$min_len = max( 20, intval( $min_len ) );

	$processed = 0;
	$updated = 0;
	$skipped = 0;
	$errors = 0;
	$no_query = 0;
	$no_hit = 0;
	$no_summary = 0;
	$debug = [];

	foreach ( $ids as $pid ) {
		$pid = intval( $pid );
		if ( $pid <= 0 ) {
			continue;
		}
		if ( 'vtuber' !== get_post_type( $pid ) || 'publish' !== get_post_status( $pid ) ) {
			continue;
		}
		$processed++;

		$existing = trim( (string) get_post_meta( $pid, 'vt_summary', true ) );
		$weak_summary = vt_maint_summary_is_weak_text( $existing, $min_len );
		if ( ! $force && ! $weak_summary ) {
			$skipped++;
			if ( count( $debug ) < 12 ) {
				$debug[] = [ 'id' => $pid, 'reason' => 'strong_summary_skip' ];
			}
			continue;
		}

		$disp = trim( (string) get_post_meta( $pid, 'vt_display_name', true ) );
		$title = trim( (string) get_the_title( $pid ) );
		$name = '' !== $disp ? $disp : $title;
		$q_name = vt_maint_moegirl_pick_query_from_name( $name );
		$q_slug = vt_maint_moegirl_pick_query_from_slug( (string) get_post_field( 'post_name', $pid ) );
		$q_candidates = array_values( array_filter( array_unique( [ $q_name, $q_slug ] ) ) );
		if ( empty( $q_candidates ) ) {
			$skipped++;
			$no_query++;
			update_post_meta( $pid, 'vt_moegirl_last_try', time() );
			if ( count( $debug ) < 12 ) {
				$debug[] = [ 'id' => $pid, 'name' => $name, 'reason' => 'empty_query' ];
			}
			continue;
		}
		$q = '';
		$mg_title = '';
		$mg_url = '';
		$extract = '';
		$tried = [];
		foreach ( $q_candidates as $q_try ) {
			$q_try = trim( (string) $q_try );
			if ( '' === $q_try ) {
				continue;
			}
			$tried[] = $q_try;
			$hit = vt_maint_moegirl_opensearch_first( $q_try );
			$try_title = trim( (string) ( $hit['title'] ?? '' ) );
			if ( '' === $try_title ) {
				continue;
			}
			$try_extract = vt_maint_moegirl_extract_intro( $try_title );
			if ( ! vt_maint_moegirl_is_probable_match( $name, $q_try, $try_title, $try_extract ) ) {
				continue;
			}
			$q = $q_try;
			$mg_title = $try_title;
			$mg_url = vt_maint_clean_url( (string) ( $hit['url'] ?? '' ) );
			$extract = $try_extract;
			break;
		}
		if ( '' === $mg_title ) {
			$skipped++;
			$no_hit++;
			update_post_meta( $pid, 'vt_moegirl_last_try', time() );
			if ( count( $debug ) < 12 ) {
				$debug[] = [ 'id' => $pid, 'name' => $name, 'q' => implode( '|', $tried ), 'reason' => 'no_hit' ];
			}
			continue;
		}

		$summary = vt_maint_moegirl_build_summary( $name, $extract, $mg_title );
		if ( '' === $summary && '' !== $mg_title ) {
			$summary = trim( $name ) . '：可參考萌娘百科條目《' . $mg_title . '》以了解更多公開資訊。';
			$summary = vt_maint_mb_substr( $summary, 180 );
		}
		if ( '' === $summary ) {
			$errors++;
			$no_summary++;
			update_post_meta( $pid, 'vt_moegirl_last_try', time() );
			if ( count( $debug ) < 12 ) {
				$debug[] = [ 'id' => $pid, 'name' => $name, 'q' => $q, 'moegirl' => $mg_title, 'reason' => 'empty_summary' ];
			}
			continue;
		}

		update_post_meta( $pid, 'vt_summary', $summary );
		update_post_meta( $pid, 'vt_moegirl_title', $mg_title );
		update_post_meta( $pid, 'vt_moegirl_query', $q );
		if ( '' !== $mg_url ) {
			update_post_meta( $pid, 'vt_moegirl_url', $mg_url );
		}
		update_post_meta( $pid, 'vt_moegirl_last_try', time() );
		update_post_meta( $pid, 'vt_moegirl_synced_utc', gmdate( 'c' ) );
		$updated++;
		if ( count( $debug ) < 12 ) {
			$debug[] = [ 'id' => $pid, 'name' => $name, 'q' => $q, 'moegirl' => $mg_title, 'reason' => 'updated' ];
		}
	}

	return [
		'ok'         => 1,
		'processed'  => $processed,
		'updated'    => $updated,
		'skipped'    => $skipped,
		'errors'     => $errors,
		'no_query'   => $no_query,
		'no_hit'     => $no_hit,
		'no_summary' => $no_summary,
		'debug'      => $debug,
	];
}

function vt_maint_moegirl_cleanup_bad_matches_run( $batch = 200 ) {
	global $wpdb;
	$batch = max( 1, min( 1000, intval( $batch ) ) );
	$sql = $wpdb->prepare(
		"\n\t\tSELECT p.ID,\n\t\t\tCOALESCE(m_title.meta_value, '') AS mg_title,\n\t\t\tCOALESCE(m_query.meta_value, '') AS mg_query,\n\t\t\tCOALESCE(m_sum.meta_value, '') AS summary\n\t\tFROM {$wpdb->posts} p\n\t\tLEFT JOIN {$wpdb->postmeta} m_title ON (m_title.post_id = p.ID AND m_title.meta_key = 'vt_moegirl_title')\n\t\tLEFT JOIN {$wpdb->postmeta} m_query ON (m_query.post_id = p.ID AND m_query.meta_key = 'vt_moegirl_query')\n\t\tLEFT JOIN {$wpdb->postmeta} m_sum   ON (m_sum.post_id   = p.ID AND m_sum.meta_key   = 'vt_summary')\n\t\tWHERE p.post_type='vtuber'\n\t\tAND p.post_status='publish'\n\t\tAND (\n\t\t\tm_title.meta_value LIKE %s\n\t\t\tOR (m_query.meta_value IS NOT NULL AND CHAR_LENGTH(m_query.meta_value) <= 2)\n\t\t)\n\t\tLIMIT %d\n\t\t",
		'%(个人势)%',
		$batch
	);
	$rows = $wpdb->get_results( $sql, ARRAY_A );
	$checked = 0;
	$cleaned = 0;
	foreach ( (array) $rows as $r ) {
		$pid = intval( $r['ID'] ?? 0 );
		if ( $pid <= 0 ) {
			continue;
		}
		$checked++;
		$mg_title = trim( (string) ( $r['mg_title'] ?? '' ) );
		$mg_query = trim( (string) ( $r['mg_query'] ?? '' ) );
		$summary  = trim( (string) ( $r['summary'] ?? '' ) );
		$marker = '' !== $mg_title ? ( '可參考萌娘百科條目《' . $mg_title . '》' ) : '可參考萌娘百科條目《';
		$is_short_q = ( '' !== $mg_query && ( function_exists( 'mb_strlen' ) ? mb_strlen( $mg_query, 'UTF-8' ) : strlen( $mg_query ) ) <= 2 );
		if ( '' !== $summary && false !== strpos( $summary, $marker ) && ( false !== strpos( $mg_title, '(个人势)' ) || $is_short_q ) ) {
			delete_post_meta( $pid, 'vt_summary' );
			delete_post_meta( $pid, 'vt_moegirl_title' );
			delete_post_meta( $pid, 'vt_moegirl_url' );
			delete_post_meta( $pid, 'vt_moegirl_query' );
			delete_post_meta( $pid, 'vt_moegirl_synced_utc' );
			$cleaned++;
		}
	}
	return [
		'ok'      => 1,
		'checked' => $checked,
		'cleaned' => $cleaned,
	];
}

function vt_maint_is_placeholder_avatar_url( $url ) {
	$s = vt_maint_lower( trim( (string) $url ) );
	if ( '' === $s ) {
		return true;
	}
	return (
		false !== strpos( $s, 'vt-placeholder' ) ||
		false !== strpos( $s, '/xarth/' ) ||
		false !== strpos( $s, '404_user_70x70' ) ||
		false !== strpos( $s, '404_user_300x300' ) ||
		// Twitch static logo/placeholder assets (commonly returned by og:image on invalid pages).
		false !== strpos( $s, 'static-cdn.jtvnw.net/ttv-static' ) ||
		false !== strpos( $s, 'twitchcdn.net/assets' ) ||
		// X/Twitter default avatars.
		false !== strpos( $s, 'abs.twimg.com/sticky/default_profile_images' ) ||
		false !== strpos( $s, 'default_profile_images' )
	);
}

function vt_maint_post_needs_thumbnail( $post_id ) {
	if ( ! has_post_thumbnail( $post_id ) ) {
		// Allow external fallback thumb URLs (vt_thumb_url / vt_thumb_source_url)
		// so frontend can still render a valid avatar when local media sideload fails.
		$fallback = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_thumb_url', true ) );
		if ( '' === $fallback ) {
			$fallback = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_thumb_source_url', true ) );
		}
		if ( '' !== $fallback && ! vt_maint_is_placeholder_avatar_url( $fallback ) ) {
			return false;
		}
		return true;
	}
	$thumb_id = intval( get_post_thumbnail_id( $post_id ) );
	$thumb_url = get_the_post_thumbnail_url( $post_id, 'full' );
	if ( '' === trim( (string) $thumb_url ) ) {
		return true;
	}
	if ( vt_maint_is_placeholder_avatar_url( $thumb_url ) ) {
		return true;
	}
	// Some placeholder images are sideloaded into the media library, so the final
	// attachment URL no longer contains the original placeholder host/path.
	// Use the recorded source URL as an additional signal.
	$src_url = (string) get_post_meta( $post_id, 'vt_thumb_source_url', true );
	if ( '' !== trim( $src_url ) && vt_maint_is_placeholder_avatar_url( $src_url ) ) {
		return true;
	}
	if ( $thumb_id > 0 ) {
		$file = get_attached_file( $thumb_id );
		if ( is_string( $file ) && file_exists( $file ) ) {
			$fs = intval( @filesize( $file ) );
			if ( $fs > 0 && $fs < 4500 ) {
				return true;
			}
			$sz = @getimagesize( $file );
			$w  = intval( $sz[0] ?? 0 );
			$h  = intval( $sz[1] ?? 0 );
			if ( $w > 0 && $h > 0 && ( $w < 120 || $h < 120 ) ) {
				return true;
			}
		}
	}
	return false;
}

function vt_maint_post_has_any_social_url( $post_id ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return false;
	}
	// Keep this list aligned with avatar_diagnose "no_social_url" criteria.
	$keys = [
		'vt_youtube_url',
		'vt_twitch_url',
		'vt_twitter_url',
		'vt_facebook_url',
		'vt_instagram_url',
		'vt_bluesky_url',
	];
	foreach ( $keys as $k ) {
		$v = vt_maint_clean_url( (string) get_post_meta( $post_id, $k, true ) );
		if ( '' !== $v ) {
			return true;
		}
	}
	return false;
}

function vt_maint_social_summary_candidates( $post_id, $api_key = '' ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return [];
	}
	$out = [];
	$seen = [];
	$add = static function ( $source, $text ) use ( &$out, &$seen ) {
		$txt = trim( wp_strip_all_tags( html_entity_decode( (string) $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ) );
		$txt = trim( preg_replace( '/\s+/u', ' ', $txt ) );
		if ( '' === $txt ) {
			return;
		}
		$len = function_exists( 'mb_strlen' ) ? intval( mb_strlen( $txt, 'UTF-8' ) ) : strlen( $txt );
		if ( $len < 16 ) {
			return;
		}
		$k = md5( vt_maint_lower( $txt ) );
		if ( isset( $seen[ $k ] ) ) {
			return;
		}
		$seen[ $k ] = 1;
		$out[] = [
			'source'  => (string) $source,
			'summary' => $txt,
		];
	};

	$api_key = trim( (string) $api_key );
	if ( '' === $api_key ) {
		$api_key = vt_maint_sheet_api_key();
	}

	$yt_url = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_youtube_url', true ) );
	if ( '' !== $yt_url && '' !== $api_key ) {
		$cid = trim( (string) get_post_meta( $post_id, 'vt_youtube_channel_id', true ) );
		if ( '' === $cid ) {
			$cid = (string) vt_maint_resolve_youtube_channel_id( $yt_url, $api_key );
			if ( '' !== $cid ) {
				update_post_meta( $post_id, 'vt_youtube_channel_id', $cid );
			}
		}
		if ( '' !== $cid ) {
			$yt = vt_maint_fetch_youtube_meta( $cid, $api_key );
			$add( 'youtube_api', (string) ( $yt['summary'] ?? '' ) );
		}
	}

	$tw_url = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_twitch_url', true ) );
	if ( '' !== $tw_url ) {
		$t_meta = vt_maint_fetch_twitch_meta( $tw_url );
		$add( 'twitch_api', (string) ( $t_meta['summary'] ?? '' ) );
	}

	$social_map = [
		'youtube_og'    => $yt_url,
		'twitch_og'     => $tw_url,
		'twitter_og'    => vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_twitter_url', true ) ),
		'facebook_og'   => vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_facebook_url', true ) ),
		'bluesky_og'    => vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_bluesky_url', true ) ),
		'affiliation_og'=> vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_affiliation_url', true ) ),
		'official_og'   => vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_official_url', true ) ),
	];
	foreach ( $social_map as $label => $u ) {
		if ( '' === $u ) {
			continue;
		}
		$m = vt_maint_fetch_og_profile_meta( $u );
		$add( (string) $label, (string) ( $m['description'] ?? '' ) );
	}
	return $out;
}

function vt_maint_pick_best_social_summary( $post_id, $api_key = '' ) {
	$cands = vt_maint_social_summary_candidates( $post_id, $api_key );
	if ( empty( $cands ) ) {
		return [ 'summary' => '', 'source' => '' ];
	}
	$best = $cands[0];
	foreach ( $cands as $it ) {
		$a = (string) ( $it['summary'] ?? '' );
		$b = (string) ( $best['summary'] ?? '' );
		$la = function_exists( 'mb_strlen' ) ? intval( mb_strlen( $a, 'UTF-8' ) ) : strlen( $a );
		$lb = function_exists( 'mb_strlen' ) ? intval( mb_strlen( $b, 'UTF-8' ) ) : strlen( $b );
		if ( $la > $lb ) {
			$best = $it;
		}
	}
	$summary = wp_trim_words( (string) ( $best['summary'] ?? '' ), 120 );
	return [
		'summary' => trim( (string) $summary ),
		'source'  => trim( (string) ( $best['source'] ?? '' ) ),
	];
}

function vt_maint_post_needs_social_enrich( $post_id ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return false;
	}
	$yt_url = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_youtube_url', true ) );
	$tw_url = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_twitch_url', true ) );
	$x_url  = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_twitter_url', true ) );

	// Backfill stable identifiers used for de-dupe/search (even if metrics already exist).
	if ( '' !== $yt_url && '' === trim( (string) get_post_meta( $post_id, 'vt_youtube_channel_id', true ) ) ) {
		return true;
	}
	if ( '' !== $tw_url && '' === trim( (string) get_post_meta( $post_id, 'vt_twitch_login', true ) ) ) {
		return true;
	}
	if ( '' !== $x_url && '' === trim( (string) get_post_meta( $post_id, 'vt_twitter_handle', true ) ) ) {
		return true;
	}
	if ( '' !== $yt_url && intval( get_post_meta( $post_id, 'vt_youtube_subs', true ) ) <= 0 ) {
		return true;
	}
	if ( '' !== $tw_url && intval( get_post_meta( $post_id, 'vt_twitch_followers', true ) ) <= 0 ) {
		return true;
	}
	if ( vt_maint_post_has_any_social_url( $post_id ) && vt_maint_summary_needs_enrich( (string) get_post_meta( $post_id, 'vt_summary', true ) ) ) {
		return true;
	}
	return false;
}

function vt_maint_set_thumbnail_from_url( $post_id, $url ) {
	$url = vt_maint_clean_url( $url );
	if ( '' === $url || vt_maint_is_placeholder_avatar_url( $url ) ) {
		return 0;
	}
	vt_maint_require_media_api();
	$tmp = download_url( $url, 25 );
	if ( is_wp_error( $tmp ) ) {
		return 0;
	}
	$path_name = basename( (string) ( parse_url( $url, PHP_URL_PATH ) ?: 'avatar.jpg' ) );
	if ( ! preg_match( '/\.(jpe?g|png|gif|webp|avif)$/i', $path_name ) ) {
		$path_name .= '.jpg';
	}
	$file = [
		'name'     => $path_name,
		'tmp_name' => $tmp,
	];
	$mid = media_handle_sideload( $file, $post_id );
	if ( is_wp_error( $mid ) ) {
		@unlink( $tmp );
		return 0;
	}
	set_post_thumbnail( $post_id, $mid );
	$img = wp_get_attachment_url( $mid );
	if ( $img ) {
		update_post_meta( $post_id, 'vt_thumb_url', $img );
	}
	update_post_meta( $post_id, 'vt_thumb_source_url', $url );
	update_post_meta( $post_id, 'vt_thumb_refreshed_utc', gmdate( 'c' ) );
	return intval( $mid );
}

function vt_maint_try_resolve_avatar_for_post( $post_id, $api_key = '' ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return [ 'ok' => 0, 'set' => 0, 'social_updated' => 0, 'reason' => 'invalid_post', 'tried' => [] ];
	}
	$need_thumb  = vt_maint_post_needs_thumbnail( $post_id );
	$need_social = vt_maint_post_needs_social_enrich( $post_id );
	if ( ! $need_thumb && ! $need_social ) {
		return [ 'ok' => 1, 'set' => 0, 'social_updated' => 0, 'reason' => 'already_ok', 'tried' => [] ];
	}

	$api_key = trim( (string) $api_key );
	if ( '' === $api_key ) {
		$api_key = vt_maint_sheet_api_key();
	}

	$tried = [];
	$social_updated = 0;
	$soft_thumb_candidate = '';
	$thumb = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_thumb_url', true ) );
	if ( $need_thumb && '' !== $thumb && ! vt_maint_is_placeholder_avatar_url( $thumb ) ) {
		$tried[] = 'stored_thumb';
		if ( vt_maint_set_thumbnail_from_url( $post_id, $thumb ) > 0 ) {
			return [ 'ok' => 1, 'set' => 1, 'social_updated' => $social_updated, 'reason' => 'stored_thumb', 'tried' => $tried ];
		}
		$soft_thumb_candidate = $thumb;
	}

	$src_thumb = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_thumb_source_url', true ) );
	if ( $need_thumb && '' !== $src_thumb && ! vt_maint_is_placeholder_avatar_url( $src_thumb ) ) {
		$tried[] = 'stored_source_thumb';
		if ( vt_maint_set_thumbnail_from_url( $post_id, $src_thumb ) > 0 ) {
			return [ 'ok' => 1, 'set' => 1, 'social_updated' => $social_updated, 'reason' => 'stored_source_thumb', 'tried' => $tried ];
		}
		if ( '' === $soft_thumb_candidate ) {
			$soft_thumb_candidate = $src_thumb;
		}
	}

	$yt_url = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_youtube_url', true ) );
	$need_ytid = '' !== $yt_url && '' === trim( (string) get_post_meta( $post_id, 'vt_youtube_channel_id', true ) );
	if ( '' !== $yt_url && '' !== $api_key && ( $need_thumb || $need_ytid || intval( get_post_meta( $post_id, 'vt_youtube_subs', true ) ) <= 0 ) ) {
		$tried[] = 'youtube';
		$cid = vt_maint_resolve_youtube_channel_id( $yt_url, $api_key );
		if ( '' !== (string) $cid && $need_ytid ) {
			update_post_meta( $post_id, 'vt_youtube_channel_id', (string) $cid );
			$social_updated++;
		}
		$yt  = vt_maint_fetch_youtube_meta( $cid, $api_key );
		if ( ! empty( $yt['subs'] ) && intval( get_post_meta( $post_id, 'vt_youtube_subs', true ) ) <= 0 ) {
			update_post_meta( $post_id, 'vt_youtube_subs', intval( $yt['subs'] ) );
			delete_post_meta( $post_id, 'vt_youtube_subs_unavailable' );
			delete_post_meta( $post_id, 'vt_youtube_subs_status' );
			update_post_meta( $post_id, 'vt_youtube_subs_checked_utc', gmdate( 'c' ) );
			$social_updated++;
		} elseif ( '' !== (string) $cid && intval( get_post_meta( $post_id, 'vt_youtube_subs', true ) ) <= 0 ) {
			update_post_meta( $post_id, 'vt_youtube_subs_unavailable', 1 );
			update_post_meta( $post_id, 'vt_youtube_subs_status', 'subs_hidden_or_unavailable' );
			update_post_meta( $post_id, 'vt_youtube_subs_checked_utc', gmdate( 'c' ) );
		} elseif ( '' === (string) $cid && intval( get_post_meta( $post_id, 'vt_youtube_subs', true ) ) <= 0 ) {
			$yt_identity = vt_maint_youtube_identity_from_url( $yt_url );
			if ( '' === $yt_identity ) {
				update_post_meta( $post_id, 'vt_youtube_subs_unavailable', 1 );
				update_post_meta( $post_id, 'vt_youtube_subs_status', 'invalid_or_unresolvable_url' );
				update_post_meta( $post_id, 'vt_youtube_subs_checked_utc', gmdate( 'c' ) );
			}
		}
		$summary_now = (string) get_post_meta( $post_id, 'vt_summary', true );
		if ( vt_maint_summary_needs_enrich( $summary_now ) && ! empty( $yt['summary'] ) ) {
			update_post_meta( $post_id, 'vt_summary', wp_trim_words( wp_strip_all_tags( (string) $yt['summary'] ), 120 ) );
			update_post_meta( $post_id, 'vt_summary_source', 'youtube_api' );
			$social_updated++;
		}
		if ( $need_thumb && ! empty( $yt['avatar'] ) ) {
			$yt_avatar = vt_maint_clean_url( (string) $yt['avatar'] );
			if ( '' !== $yt_avatar && ! vt_maint_is_placeholder_avatar_url( $yt_avatar ) ) {
				if ( vt_maint_set_thumbnail_from_url( $post_id, $yt_avatar ) > 0 ) {
					return [ 'ok' => 1, 'set' => 1, 'social_updated' => $social_updated, 'reason' => 'youtube', 'tried' => $tried ];
				}
				if ( '' === $soft_thumb_candidate ) {
					$soft_thumb_candidate = $yt_avatar;
				}
			}
		}
	}
	if ( $need_thumb ) {
		$yt_og  = vt_maint_fetch_og_image_url( $yt_url );
		if ( '' !== $yt_og ) {
			$tried[] = 'youtube_og';
			if ( vt_maint_set_thumbnail_from_url( $post_id, $yt_og ) > 0 ) {
				return [ 'ok' => 1, 'set' => 1, 'social_updated' => $social_updated, 'reason' => 'youtube_og', 'tried' => $tried ];
			}
		}
	}

	$tw_url = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_twitch_url', true ) );
	$need_twlogin = '' !== $tw_url && '' === trim( (string) get_post_meta( $post_id, 'vt_twitch_login', true ) );
	if ( $need_twlogin ) {
		$tw_login = vt_maint_twitch_login_from_url( $tw_url );
		if ( '' !== $tw_login ) {
			update_post_meta( $post_id, 'vt_twitch_login', (string) $tw_login );
			$social_updated++;
		}
	}
	if ( '' !== $tw_url && ( $need_thumb || $need_twlogin || intval( get_post_meta( $post_id, 'vt_twitch_followers', true ) ) <= 0 || vt_maint_summary_needs_enrich( (string) get_post_meta( $post_id, 'vt_summary', true ) ) ) ) {
		$tried[] = 'twitch';
		$t_meta = vt_maint_fetch_twitch_meta( $tw_url );
		if ( ! empty( $t_meta['followers'] ) && intval( get_post_meta( $post_id, 'vt_twitch_followers', true ) ) <= 0 ) {
			update_post_meta( $post_id, 'vt_twitch_followers', intval( $t_meta['followers'] ) );
			delete_post_meta( $post_id, 'vt_twitch_followers_unavailable' );
			delete_post_meta( $post_id, 'vt_twitch_followers_status' );
			update_post_meta( $post_id, 'vt_twitch_followers_checked_utc', gmdate( 'c' ) );
			$social_updated++;
		} elseif ( intval( get_post_meta( $post_id, 'vt_twitch_followers', true ) ) <= 0 ) {
			$tw_status = trim( (string) ( $t_meta['status'] ?? '' ) );
			if ( '' === $tw_status ) {
				$tw_status = 'unavailable';
			}
			if ( 'ok' === $tw_status ) {
				update_post_meta( $post_id, 'vt_twitch_followers', 0 );
				update_post_meta( $post_id, 'vt_twitch_followers_status', 'ok_zero' );
				update_post_meta( $post_id, 'vt_twitch_followers_checked_utc', gmdate( 'c' ) );
				$social_updated++;
			}
			if ( in_array( $tw_status, [ 'invalid_login', 'user_not_found' ], true ) ) {
				update_post_meta( $post_id, 'vt_twitch_followers_unavailable', 1 );
				update_post_meta( $post_id, 'vt_twitch_followers_status', $tw_status );
				update_post_meta( $post_id, 'vt_twitch_followers_checked_utc', gmdate( 'c' ) );
			}
		}
		$summary_now = (string) get_post_meta( $post_id, 'vt_summary', true );
		if ( vt_maint_summary_needs_enrich( $summary_now ) && ! empty( $t_meta['summary'] ) ) {
			update_post_meta( $post_id, 'vt_summary', wp_trim_words( wp_strip_all_tags( (string) $t_meta['summary'] ), 120 ) );
			update_post_meta( $post_id, 'vt_summary_source', 'twitch_api' );
			$social_updated++;
		}
		if ( $need_thumb && ! empty( $t_meta['avatar'] ) ) {
			$tw_avatar = vt_maint_clean_url( (string) $t_meta['avatar'] );
			if ( '' !== $tw_avatar && ! vt_maint_is_placeholder_avatar_url( $tw_avatar ) ) {
				if ( vt_maint_set_thumbnail_from_url( $post_id, $tw_avatar ) > 0 ) {
					return [ 'ok' => 1, 'set' => 1, 'social_updated' => $social_updated, 'reason' => 'twitch', 'tried' => $tried ];
				}
				if ( '' === $soft_thumb_candidate ) {
					$soft_thumb_candidate = $tw_avatar;
				}
			}
		}
	}
	if ( $need_thumb ) {
		$tw_og  = vt_maint_fetch_og_image_url( $tw_url );
		if ( '' !== $tw_og ) {
			$tried[] = 'twitch_og';
			if ( vt_maint_set_thumbnail_from_url( $post_id, $tw_og ) > 0 ) {
				return [ 'ok' => 1, 'set' => 1, 'social_updated' => $social_updated, 'reason' => 'twitch_og', 'tried' => $tried ];
			}
		}
	}

	// X/Twitter: we do not fetch follower counts, but we do backfill the handle for de-dupe/search/UI.
	$x_url = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_twitter_url', true ) );
	if ( '' !== $x_url && '' === trim( (string) get_post_meta( $post_id, 'vt_twitter_handle', true ) ) ) {
		$x_handle = vt_maint_twitter_handle_from_url( $x_url );
		if ( '' !== $x_handle ) {
			update_post_meta( $post_id, 'vt_twitter_handle', (string) $x_handle );
			$social_updated++;
		}
	}

	if ( $need_thumb ) {
		$social_candidates = vt_maint_social_avatar_candidates( $post_id );
		if ( ! empty( $social_candidates ) ) {
			foreach ( $social_candidates as $cand ) {
				$label = (string) ( $cand['label'] ?? 'social' );
				$url   = (string) ( $cand['url'] ?? '' );
				if ( '' === $url ) {
					continue;
				}
				$tried[] = $label;
				if ( '' === $soft_thumb_candidate && ! vt_maint_is_placeholder_avatar_url( $url ) ) {
					$soft_thumb_candidate = $url;
				}
				if ( vt_maint_set_thumbnail_from_url( $post_id, $url ) > 0 ) {
					return [ 'ok' => 1, 'set' => 1, 'social_updated' => $social_updated, 'reason' => $label, 'tried' => $tried ];
				}
			}
		}
	}

	$summary_now = (string) get_post_meta( $post_id, 'vt_summary', true );
	if ( vt_maint_summary_needs_enrich( $summary_now ) && vt_maint_post_has_any_social_url( $post_id ) ) {
		$best = vt_maint_pick_best_social_summary( $post_id, $api_key );
		$sum  = trim( (string) ( $best['summary'] ?? '' ) );
		if ( '' !== $sum ) {
			update_post_meta( $post_id, 'vt_summary', $sum );
			update_post_meta( $post_id, 'vt_summary_source', (string) ( $best['source'] ?? 'social_meta' ) );
			update_post_meta( $post_id, 'vt_summary_refreshed_utc', gmdate( 'c' ) );
			$social_updated++;
		}
	}

	if ( $need_thumb && '' !== $soft_thumb_candidate ) {
		$cur_thumb = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_thumb_url', true ) );
		if ( '' === $cur_thumb || vt_maint_is_placeholder_avatar_url( $cur_thumb ) ) {
			update_post_meta( $post_id, 'vt_thumb_url', $soft_thumb_candidate );
			update_post_meta( $post_id, 'vt_thumb_source_url', $soft_thumb_candidate );
			update_post_meta( $post_id, 'vt_thumb_refreshed_utc', gmdate( 'c' ) );
			return [
				'ok'             => 1,
				'set'            => 0,
				'social_updated' => intval( $social_updated ),
				'reason'         => 'soft_thumb_only',
				'tried'          => $tried,
			];
		}
	}

	return [
		'ok'            => 1,
		'set'           => 0,
		'social_updated'=> intval( $social_updated ),
		'reason'        => ( $need_social && ! $need_thumb && $social_updated > 0 ) ? 'social_only' : 'not_resolved',
		'tried'         => $tried,
	];
}

function vt_maint_post_lang_slug( $post_id ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return 'default';
	}
	if ( function_exists( 'pll_get_post_language' ) ) {
		$lang = (string) pll_get_post_language( $post_id, 'slug' );
		if ( '' !== trim( $lang ) ) {
			return sanitize_title( $lang );
		}
	}
	return 'default';
}

function vt_maint_dedupe_score( $post_id ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return -9999;
	}

	$score = 0.0;
	$origin = vt_maint_lower( (string) get_post_meta( $post_id, 'vt_data_origin', true ) );
	if ( 'tw_sheet' === $origin ) {
		$score += 160;
	} elseif ( 'hololist' === $origin ) {
		$score += 120;
	}
	if ( intval( get_post_meta( $post_id, 'vt_sheet_synced', true ) ) > 0 ) {
		$score += 15;
	}
	if ( ! vt_maint_post_needs_thumbnail( $post_id ) ) {
		$score += 25;
	}

	$yt_subs = intval( get_post_meta( $post_id, 'vt_youtube_subs', true ) );
	$tw_fol  = intval( get_post_meta( $post_id, 'vt_twitch_followers', true ) );
	if ( $yt_subs > 0 ) {
		$score += min( 40, ( log10( max( 1, $yt_subs ) ) * 10 ) );
	}
	if ( $tw_fol > 0 ) {
		$score += min( 30, ( log10( max( 1, $tw_fol ) ) * 10 ) );
	}

	$summary_len = strlen( trim( wp_strip_all_tags( (string) get_post_meta( $post_id, 'vt_summary', true ) ) ) );
	if ( $summary_len > 0 ) {
		$score += min( 18, 1 + intval( $summary_len / 60 ) );
	}

	$link_keys = [
		'vt_youtube_url', 'vt_twitch_url', 'vt_twitter_url', 'vt_facebook_url', 'vt_bluesky_url',
		'vt_instagram_url', 'vt_discord_url', 'vt_affiliation_url', 'vt_official_url',
	];
	foreach ( $link_keys as $k ) {
		if ( '' !== trim( (string) get_post_meta( $post_id, $k, true ) ) ) {
			$score += 6;
		}
	}

	$modified = strtotime( (string) get_post_field( 'post_modified_gmt', $post_id ) );
	if ( $modified > 0 ) {
		$score += ( $modified / 10000000000 );
	}
	// Small tie-breaker: prefer lower IDs for older stable entries.
	$score -= ( $post_id / 1000000 );
	return $score;
}

function vt_maint_merge_duplicate_into_keeper( $keep_id, $drop_id ) {
	$keep_id = intval( $keep_id );
	$drop_id = intval( $drop_id );
	if ( $keep_id <= 0 || $drop_id <= 0 || $keep_id === $drop_id ) {
		return 0;
	}

	$changed = 0;
	$meta_keys = [
		'vt_youtube_url', 'vt_twitch_url', 'vt_twitter_url', 'vt_facebook_url', 'vt_bluesky_url',
		'vt_instagram_url', 'vt_discord_url', 'vt_email', 'vt_affiliation', 'vt_affiliation_url',
		'vt_official_url', 'vt_rep_video_url', 'vt_debut_date', 'vt_hololist_url',
		'vt_marshmallow_url', 'vt_note_url',
	];
	foreach ( $meta_keys as $k ) {
		$kv = trim( (string) get_post_meta( $keep_id, $k, true ) );
		$dv = trim( (string) get_post_meta( $drop_id, $k, true ) );
		if ( '' === $kv && '' !== $dv ) {
			update_post_meta( $keep_id, $k, $dv );
			$changed++;
		}
	}

	// Keep the longer summary/note.
	$k_summary = trim( (string) get_post_meta( $keep_id, 'vt_summary', true ) );
	$d_summary = trim( (string) get_post_meta( $drop_id, 'vt_summary', true ) );
	if ( strlen( wp_strip_all_tags( $d_summary ) ) > strlen( wp_strip_all_tags( $k_summary ) ) ) {
		update_post_meta( $keep_id, 'vt_summary', $d_summary );
		$changed++;
	}
	$k_note = trim( (string) get_post_meta( $keep_id, 'vt_sheet_note', true ) );
	$d_note = trim( (string) get_post_meta( $drop_id, 'vt_sheet_note', true ) );
	if ( strlen( wp_strip_all_tags( $d_note ) ) > strlen( wp_strip_all_tags( $k_note ) ) ) {
		update_post_meta( $keep_id, 'vt_sheet_note', $d_note );
		$changed++;
	}

	$k_yt = intval( get_post_meta( $keep_id, 'vt_youtube_subs', true ) );
	$d_yt = intval( get_post_meta( $drop_id, 'vt_youtube_subs', true ) );
	if ( $d_yt > $k_yt ) {
		update_post_meta( $keep_id, 'vt_youtube_subs', $d_yt );
		$changed++;
	}
	$k_tw = intval( get_post_meta( $keep_id, 'vt_twitch_followers', true ) );
	$d_tw = intval( get_post_meta( $drop_id, 'vt_twitch_followers', true ) );
	if ( $d_tw > $k_tw ) {
		update_post_meta( $keep_id, 'vt_twitch_followers', $d_tw );
		$changed++;
	}

	// If keeper has no usable thumbnail, copy from duplicate.
	if ( vt_maint_post_needs_thumbnail( $keep_id ) && ! vt_maint_post_needs_thumbnail( $drop_id ) ) {
		$drop_thumb_id = intval( get_post_thumbnail_id( $drop_id ) );
		if ( $drop_thumb_id > 0 ) {
			set_post_thumbnail( $keep_id, $drop_thumb_id );
			$u = (string) get_the_post_thumbnail_url( $keep_id, 'full' );
			if ( '' !== trim( $u ) ) {
				update_post_meta( $keep_id, 'vt_thumb_url', $u );
			}
			$changed++;
		}
	}

	// Merge key taxonomies.
	foreach ( [ 'life-status', 'platform', 'agency', 'role-tag', 'franchise' ] as $tax ) {
		if ( ! taxonomy_exists( $tax ) ) {
			continue;
		}
		$drop_terms = wp_get_object_terms( $drop_id, $tax, [ 'fields' => 'ids' ] );
		if ( ! empty( $drop_terms ) && ! is_wp_error( $drop_terms ) ) {
			$r = wp_set_object_terms( $keep_id, array_map( 'intval', (array) $drop_terms ), $tax, true );
			if ( ! is_wp_error( $r ) ) {
				$changed++;
			}
		}
	}

	// Keep translation map complete if duplicates had different linked translations.
	if ( function_exists( 'pll_get_post_translations' ) && function_exists( 'pll_save_post_translations' ) && function_exists( 'pll_get_post_language' ) ) {
		$keep_map = pll_get_post_translations( $keep_id );
		$drop_map = pll_get_post_translations( $drop_id );
		if ( is_array( $keep_map ) && is_array( $drop_map ) ) {
			foreach ( $drop_map as $lang => $pid ) {
				$lang = sanitize_title( (string) $lang );
				$pid  = intval( $pid );
				if ( '' === $lang || $pid <= 0 || $pid === $drop_id ) {
					continue;
				}
				if ( ! isset( $keep_map[ $lang ] ) || intval( $keep_map[ $lang ] ) <= 0 ) {
					$keep_map[ $lang ] = $pid;
				}
			}
			$keep_lang = sanitize_title( (string) pll_get_post_language( $keep_id, 'slug' ) );
			if ( '' !== $keep_lang ) {
				$keep_map[ $keep_lang ] = $keep_id;
			}
			try {
				pll_save_post_translations( $keep_map );
			} catch ( Throwable $e ) {
				// ignore
			}
		}
	}

	// Keep post excerpt/content if keeper is empty but duplicate has content.
	$keep_excerpt = trim( (string) get_post_field( 'post_excerpt', $keep_id ) );
	$drop_excerpt = trim( (string) get_post_field( 'post_excerpt', $drop_id ) );
	$keep_content = trim( (string) get_post_field( 'post_content', $keep_id ) );
	$drop_content = trim( (string) get_post_field( 'post_content', $drop_id ) );
	$update_post  = [ 'ID' => $keep_id ];
	$need_update  = false;
	if ( '' === $keep_excerpt && '' !== $drop_excerpt ) {
		$update_post['post_excerpt'] = $drop_excerpt;
		$need_update = true;
	}
	if ( '' === $keep_content && '' !== $drop_content ) {
		$update_post['post_content'] = $drop_content;
		$need_update = true;
	}
	if ( $need_update ) {
		wp_update_post( $update_post );
		$changed++;
	}

	return $changed;
}

function vt_maint_dedupe_vtuber_run( $batch = 0 ) {
	$lock_key = 'vt_maint_dedupe_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 1800, 5400 ) ) {
		return [ 'locked' => 1 ];
	}

	try {
		$q = new WP_Query(
			[
				'post_type'      => 'vtuber',
				'post_status'    => 'publish',
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
			]
		);
		$ids = is_array( $q->posts ) ? array_map( 'intval', $q->posts ) : [];
		wp_reset_postdata();

		$groups = [];
		foreach ( $ids as $pid ) {
			$lang = vt_maint_post_lang_slug( $pid );
			$ytid = trim( (string) get_post_meta( $pid, 'vt_youtube_channel_id', true ) );
			$twlogin = trim( (string) get_post_meta( $pid, 'vt_twitch_login', true ) );
			$xhandle = trim( (string) get_post_meta( $pid, 'vt_twitter_handle', true ) );
			$yt = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_youtube_url', true ) );
			$tw = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_twitch_url', true ) );
			$x  = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_twitter_url', true ) );
			$hl = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_hololist_url', true ) );
			$off= vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_official_url', true ) );
			$cjk = trim( (string) get_post_meta( $pid, 'vt_name_cjk_key', true ) );
			$latin = trim( (string) get_post_meta( $pid, 'vt_name_latin_key', true ) );
			$tkey = vt_maint_title_key( (string) get_the_title( $pid ) );
			$dkey = vt_maint_title_key( (string) get_post_meta( $pid, 'vt_display_name', true ) );

			$key = '';
			if ( '' !== $ytid ) {
				$key = "lang:$lang|ytid:$ytid";
			} elseif ( '' !== $twlogin ) {
				$key = "lang:$lang|twlogin:" . strtolower( $twlogin );
			} elseif ( '' !== $xhandle ) {
				$key = "lang:$lang|xhandle:" . strtolower( $xhandle );
			} elseif ( '' !== $yt ) {
				$key = "lang:$lang|yt:$yt";
			} elseif ( '' !== $tw ) {
				$key = "lang:$lang|tw:$tw";
			} elseif ( '' !== $x ) {
				$key = "lang:$lang|x:$x";
			} elseif ( '' !== $hl ) {
				$key = "lang:$lang|hololist:$hl";
			} elseif ( '' !== $off ) {
				$key = "lang:$lang|official:$off";
			} elseif ( '' !== $cjk ) {
				$key = "lang:$lang|cjk:$cjk";
			} elseif ( '' !== $latin && strlen( $latin ) >= 6 ) {
				$key = "lang:$lang|latin:$latin";
			} elseif ( '' !== $dkey ) {
				$key = "lang:$lang|title:$dkey";
			} elseif ( '' !== $tkey ) {
				$key = "lang:$lang|title:$tkey";
			}

			if ( '' === $key ) {
				continue;
			}
			if ( ! isset( $groups[ $key ] ) ) {
				$groups[ $key ] = [];
			}
			$groups[ $key ][] = $pid;
		}

		$deleted = 0;
		$merged  = 0;
		$checked_groups = 0;
		$samples = [];
		foreach ( $groups as $key => $group_ids ) {
			$group_ids = array_values( array_unique( array_map( 'intval', (array) $group_ids ) ) );
			if ( count( $group_ids ) <= 1 ) {
				continue;
			}
			$checked_groups++;
			if ( $batch > 0 && $checked_groups > $batch ) {
				break;
			}

			$keep_id = 0;
			$best = -999999;
			foreach ( $group_ids as $pid ) {
				$score = vt_maint_dedupe_score( $pid );
				if ( $score > $best || ( abs( $score - $best ) < 0.00001 && ( $keep_id <= 0 || $pid < $keep_id ) ) ) {
					$best = $score;
					$keep_id = $pid;
				}
			}
			if ( $keep_id <= 0 ) {
				continue;
			}

			foreach ( $group_ids as $pid ) {
				if ( $pid === $keep_id ) {
					continue;
				}
				$merged += intval( vt_maint_merge_duplicate_into_keeper( $keep_id, $pid ) );
				$title = (string) get_the_title( $pid );
				wp_delete_post( $pid, true );
				$deleted++;
				if ( count( $samples ) < 60 ) {
					$samples[] = [
						'deleted_id' => intval( $pid ),
						'deleted_title' => $title,
						'kept_id' => intval( $keep_id ),
						'group_key' => $key,
					];
				}
			}
		}

		$report = [
			'ok' => 1,
			'total_posts' => count( $ids ),
			'groups' => count( $groups ),
			'checked_groups' => $checked_groups,
			'deleted' => $deleted,
			'merged_fields' => $merged,
			'samples' => $samples,
			'utc' => gmdate( 'c' ),
		];
		$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		@file_put_contents( $dir . 'dedupe-last.json', wp_json_encode( $report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
		vt_maint_log( 'dedupe groups=' . count( $groups ) . ' checked=' . $checked_groups . ' deleted=' . $deleted . ' merged=' . $merged );
		return $report;
	} catch ( Throwable $e ) {
		vt_maint_log( 'dedupe fatal=' . $e->getMessage() );
		return [ 'ok' => 0, 'error' => 'dedupe_exception', 'msg' => $e->getMessage() ];
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_metrics_diagnose_report() {
	global $wpdb;
	if ( ! $wpdb ) {
		return [ 'ok' => 0, 'error' => 'no_db' ];
	}

	$posts = $wpdb->posts;
	$pm    = $wpdb->postmeta;

	$yt_total = intval(
		$wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT p.ID) FROM {$posts} p
				 JOIN {$pm} my ON (my.post_id=p.ID AND my.meta_key=%s AND my.meta_value<>'' )
				 WHERE p.post_type=%s AND p.post_status=%s",
				'vt_youtube_url',
				'vtuber',
				'publish'
			)
		)
	);
	$yt_unavailable = intval(
		$wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT p.ID) FROM {$posts} p
				 JOIN {$pm} my ON (my.post_id=p.ID AND my.meta_key=%s AND my.meta_value<>'' )
				 JOIN {$pm} yu ON (yu.post_id=p.ID AND yu.meta_key=%s AND yu.meta_value='1')
				 WHERE p.post_type=%s AND p.post_status=%s",
				'vt_youtube_url',
				'vt_youtube_subs_unavailable',
				'vtuber',
				'publish'
			)
		)
	);
	$yt_missing = intval(
		$wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT p.ID) FROM {$posts} p
				 JOIN {$pm} my ON (my.post_id=p.ID AND my.meta_key=%s AND my.meta_value<>'' )
				 LEFT JOIN {$pm} ms ON (ms.post_id=p.ID AND ms.meta_key=%s)
				 LEFT JOIN {$pm} yu ON (yu.post_id=p.ID AND yu.meta_key=%s)
				 WHERE p.post_type=%s AND p.post_status=%s
				   AND (ms.meta_value IS NULL OR CAST(ms.meta_value AS UNSIGNED)=0)
				   AND COALESCE(yu.meta_value, '0') <> '1'",
				'vt_youtube_url',
				'vt_youtube_subs',
				'vt_youtube_subs_unavailable',
				'vtuber',
				'publish'
			)
		)
	);

	$tw_total = intval(
		$wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT p.ID) FROM {$posts} p
				 JOIN {$pm} mt ON (mt.post_id=p.ID AND mt.meta_key=%s AND mt.meta_value<>'' )
				 WHERE p.post_type=%s AND p.post_status=%s",
				'vt_twitch_url',
				'vtuber',
				'publish'
			)
		)
	);
	$tw_unavailable = intval(
		$wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT p.ID) FROM {$posts} p
				 JOIN {$pm} mt ON (mt.post_id=p.ID AND mt.meta_key=%s AND mt.meta_value<>'' )
				 JOIN {$pm} tu ON (tu.post_id=p.ID AND tu.meta_key=%s AND tu.meta_value='1')
				 WHERE p.post_type=%s AND p.post_status=%s",
				'vt_twitch_url',
				'vt_twitch_followers_unavailable',
				'vtuber',
				'publish'
			)
		)
	);
	$tw_zero_known = intval(
		$wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT p.ID) FROM {$posts} p
				 JOIN {$pm} mt ON (mt.post_id=p.ID AND mt.meta_key=%s AND mt.meta_value<>'' )
				 JOIN {$pm} ts ON (ts.post_id=p.ID AND ts.meta_key=%s AND ts.meta_value='ok_zero')
				 WHERE p.post_type=%s AND p.post_status=%s",
				'vt_twitch_url',
				'vt_twitch_followers_status',
				'vtuber',
				'publish'
			)
		)
	);
	$tw_missing = intval(
		$wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT p.ID) FROM {$posts} p
				 JOIN {$pm} mt ON (mt.post_id=p.ID AND mt.meta_key=%s AND mt.meta_value<>'' )
				 LEFT JOIN {$pm} mf ON (mf.post_id=p.ID AND mf.meta_key=%s)
				 LEFT JOIN {$pm} tu ON (tu.post_id=p.ID AND tu.meta_key=%s)
				 LEFT JOIN {$pm} ts ON (ts.post_id=p.ID AND ts.meta_key=%s)
				 WHERE p.post_type=%s AND p.post_status=%s
				   AND (mf.meta_value IS NULL OR CAST(mf.meta_value AS UNSIGNED)=0)
				   AND COALESCE(tu.meta_value, '0') <> '1'
				   AND COALESCE(ts.meta_value, '') <> 'ok_zero'",
				'vt_twitch_url',
				'vt_twitch_followers',
				'vt_twitch_followers_unavailable',
				'vt_twitch_followers_status',
				'vtuber',
				'publish'
			)
		)
	);

	$tw_summary_missing = intval(
		$wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT p.ID) FROM {$posts} p
				 JOIN {$pm} mt ON (mt.post_id=p.ID AND mt.meta_key=%s AND mt.meta_value<>'' )
				 LEFT JOIN {$pm} msu ON (msu.post_id=p.ID AND msu.meta_key=%s)
				 WHERE p.post_type=%s AND p.post_status=%s
				   AND (msu.meta_value IS NULL OR msu.meta_value='')",
				'vt_twitch_url',
				'vt_summary',
				'vtuber',
				'publish'
			)
		)
	);

	// Samples for operator verification.
	$sample = [
		'yt_missing_subs' => [],
		'tw_missing_followers' => [],
	];
	$sample['yt_missing_subs'] = array_values(
		array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT DISTINCT p.ID FROM {$posts} p
					 JOIN {$pm} my ON (my.post_id=p.ID AND my.meta_key=%s AND my.meta_value<>'' )
					 LEFT JOIN {$pm} ms ON (ms.post_id=p.ID AND ms.meta_key=%s)
					 LEFT JOIN {$pm} yu ON (yu.post_id=p.ID AND yu.meta_key=%s)
					 WHERE p.post_type=%s AND p.post_status=%s
					   AND (ms.meta_value IS NULL OR CAST(ms.meta_value AS UNSIGNED)=0)
					   AND COALESCE(yu.meta_value, '0') <> '1'
					 ORDER BY p.ID DESC LIMIT 25",
					'vt_youtube_url',
					'vt_youtube_subs',
					'vt_youtube_subs_unavailable',
					'vtuber',
					'publish'
				)
			)
		)
	);
	$sample['tw_missing_followers'] = array_values(
		array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT DISTINCT p.ID FROM {$posts} p
					 JOIN {$pm} mt ON (mt.post_id=p.ID AND mt.meta_key=%s AND mt.meta_value<>'' )
					 LEFT JOIN {$pm} mf ON (mf.post_id=p.ID AND mf.meta_key=%s)
					 LEFT JOIN {$pm} tu ON (tu.post_id=p.ID AND tu.meta_key=%s)
					 LEFT JOIN {$pm} ts ON (ts.post_id=p.ID AND ts.meta_key=%s)
					 WHERE p.post_type=%s AND p.post_status=%s
					   AND (mf.meta_value IS NULL OR CAST(mf.meta_value AS UNSIGNED)=0)
					   AND COALESCE(tu.meta_value, '0') <> '1'
					   AND COALESCE(ts.meta_value, '') <> 'ok_zero'
					 ORDER BY p.ID DESC LIMIT 25",
					'vt_twitch_url',
					'vt_twitch_followers',
					'vt_twitch_followers_unavailable',
					'vt_twitch_followers_status',
					'vtuber',
					'publish'
				)
			)
		)
	);

	$report = [
		'ok' => 1,
		'utc' => gmdate( 'c' ),
		'youtube' => [
			'with_url' => $yt_total,
			'missing_subs' => $yt_missing,
			'unavailable' => $yt_unavailable,
		],
		'twitch' => [
			'with_url' => $tw_total,
			'missing_followers' => $tw_missing,
			'unavailable' => $tw_unavailable,
			'known_zero_followers' => $tw_zero_known,
			'missing_summary' => $tw_summary_missing,
		],
		'samples' => $sample,
	];

	$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
	if ( ! is_dir( $dir ) ) {
		wp_mkdir_p( $dir );
	}
	@file_put_contents( $dir . 'metrics-diagnose.json', wp_json_encode( $report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
	return $report;
}

function vt_maint_sync_sheet_run( $sources_per_run = 2 ) {
	$lock_key = 'vt_maint_sync_sheet_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 1800, 5400 ) ) {
		return [ 'locked' => 1 ];
	}

	try {
		if ( function_exists( 'ignore_user_abort' ) ) {
			@ignore_user_abort( true );
		}
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 0 );
		}
		if ( function_exists( 'wp_raise_memory_limit' ) ) {
			@wp_raise_memory_limit( 'admin' );
		}
		if ( function_exists( 'ini_set' ) ) {
			@ini_set( 'memory_limit', '512M' );
		}

		$spreadsheet_id   = VT_MAINT_SHEET_ID;
		$api_key          = vt_maint_sheet_api_key();
		$sources          = vt_maint_sheet_sources();
		$total_sources    = count( (array) $sources );
		$sources_per_run  = intval( $sources_per_run );
		if ( $sources_per_run < 0 ) {
			$sources_per_run = 0;
		}
		$cursor_key       = 'vt_maint_sync_sheet_cursor';
		$cursor_start     = max( 0, intval( get_option( $cursor_key, 0 ) ) );
		$cursor_next      = $cursor_start;
		foreach ( $sources as &$src ) {
			if ( 'tw-main-reincarnated' === (string) ( $src['source_slug'] ?? '' ) ) {
				$src['label'] = 'Taiwan VTuber (main)';
				if ( isset( $src['role_tags'] ) && is_array( $src['role_tags'] ) ) {
					$src['role_tags'] = array_values(
						array_filter(
							(array) $src['role_tags'],
							function ( $name ) {
								return ! preg_match( '/(轉生|转生|reincarn)/iu', (string) $name );
							}
						)
					);
				}
			}
		}
		unset( $src );
		if ( $total_sources > 0 && $sources_per_run > 0 && $sources_per_run < $total_sources ) {
			$slice = [];
			$cursor_start = $cursor_start % $total_sources;
			for ( $i = 0; $i < $sources_per_run; $i++ ) {
				$idx = ( $cursor_start + $i ) % $total_sources;
				if ( isset( $sources[ $idx ] ) ) {
					$slice[] = $sources[ $idx ];
				}
			}
			if ( ! empty( $slice ) ) {
				$sources = $slice;
			}
			$cursor_next = ( $cursor_start + count( (array) $sources ) ) % $total_sources;
			update_option( $cursor_key, $cursor_next, false );
		}
		$sheet_titles = [];
		$use_csv_fallback = false;
		if ( '' !== $api_key ) {
			$title_res = vt_maint_fetch_sheet_titles( $spreadsheet_id, $api_key );
			if ( empty( $title_res['ok'] ) ) {
				$err = (string) ( $title_res['error'] ?? 'sheet_titles_failed' );
				vt_maint_log( "sync_sheet warn=sheet_titles_failed fallback=csv_export error=$err" );
				$use_csv_fallback = true;
			} else {
				$sheet_titles = is_array( $title_res['titles'] ) ? $title_res['titles'] : [];
			}
		} else {
			$use_csv_fallback = true;
			vt_maint_log( 'sync_sheet warn=missing_api_key fallback=csv_export' );
		}

		$sheet_map         = [];
		$sheet_sig_cjk     = [];
		$sheet_sig_latin   = [];
		$source_stats      = [];
		$total_rows        = 0;

		foreach ( $sources as $spec ) {
		$gid   = intval( $spec['gid'] ?? 0 );
		$title = isset( $sheet_titles[ $gid ] ) ? (string) $sheet_titles[ $gid ] : (string) ( $spec['label'] ?? '' );
		if ( $gid <= 0 ) {
			$source_stats[] = [ 'gid' => $gid, 'label' => (string) ( $spec['label'] ?? '' ), 'title' => $title, 'rows' => 0, 'mapped' => 0, 'error' => 'missing_sheet_gid' ];
			continue;
		}

		$rows_res = [ 'ok' => 0, 'error' => 'not_started', 'rows' => [] ];
		if ( ! $use_csv_fallback && '' !== trim( $title ) ) {
			$rows_res = vt_maint_fetch_sheet_rows( $spreadsheet_id, $title, $api_key );
		}
		if ( empty( $rows_res['ok'] ) ) {
			$rows_res = vt_maint_fetch_sheet_rows_csv( $spreadsheet_id, $gid );
			if ( empty( $rows_res['ok'] ) ) {
				$source_stats[] = [ 'gid' => $gid, 'label' => (string) ( $spec['label'] ?? '' ), 'title' => $title, 'rows' => 0, 'mapped' => 0, 'error' => (string) ( $rows_res['error'] ?? 'fetch_failed' ) ];
				continue;
			}
		}
		if ( empty( $rows_res['ok'] ) ) {
			$source_stats[] = [ 'gid' => $gid, 'label' => (string) ( $spec['label'] ?? '' ), 'title' => $title, 'rows' => 0, 'mapped' => 0, 'error' => (string) ( $rows_res['error'] ?? 'fetch_failed' ) ];
			continue;
		}
		$rows      = is_array( $rows_res['rows'] ) ? $rows_res['rows'] : [];
		$row_count = 0;
		$mapped    = 0;
		if ( empty( $rows ) ) {
			$source_stats[] = [ 'gid' => $gid, 'label' => (string) ( $spec['label'] ?? '' ), 'title' => $title, 'rows' => 0, 'mapped' => 0, 'error' => 'empty_rows' ];
			continue;
		}

			$header_cells = isset( $rows[0]['values'] ) && is_array( $rows[0]['values'] ) ? $rows[0]['values'] : [];
			$headers      = [];
			$header_count = max( 26, count( $header_cells ) );
			for ( $i = 0; $i < $header_count; $i++ ) {
			$headers[] = trim( (string) ( $header_cells[ $i ]['formattedValue'] ?? '' ) );
		}

			$col = [
				'debut'        => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ '初(介紹)', '初(自介)', '初配信', '初投稿', '初vod', '初' ] ), 0 ),
				'youtube'      => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ 'youtube' ] ), 1 ),
				'twitch'       => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ 'twitch' ] ), 2 ),
				'yt_subs'      => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ '訂閱數' ] ), 3 ),
				'tw_followers' => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ '追隨數' ] ), 3 ),
				'mixed_count'  => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ '訂閱追隨數' ] ), 3 ),
				'bluesky'      => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ 'bluesky' ] ), 4 ),
				'facebook'     => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ 'facebook' ] ), 5 ),
				'fanpage'      => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ '粉絲專頁' ] ), 6 ),
				'twitter'      => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ 'twitter', 'x' ] ), 7 ),
				'marshmallow'  => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ '棉花糖' ] ), 8 ),
				'donate'       => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ 'donate', '抖內' ] ), 9 ),
				'discord'      => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ 'discord' ] ), 10 ),
				'plurk'        => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ 'plurk' ] ), 11 ),
				'instagram'    => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ 'ig', 'instagram', 'igth', 'threads' ] ), 12 ),
				'email'        => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ '聯絡信箱', 'email' ] ), 13 ),
				'affiliation'  => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ '個人企業社團', '個人企業', '社團' ] ), 14 ),
				'note'         => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ '備註' ] ), 15 ),
				'artist'       => vt_maint_sheet_col_or_default( vt_maint_sheet_find_col( $headers, [ '繪師' ] ), 16 ),
			];

			// Values API drops rich-text hyperlinks. If the sheet uses embedded links (common for YouTube),
			// attach hyperlink fields for core social columns via a narrow Grid API range.
			if ( 'values_api' === (string) ( $rows_res['source'] ?? '' ) ) {
				vt_maint_sheet_attach_hyperlinks_for_columns(
					$rows,
					$spreadsheet_id,
					$title,
					[ $col['youtube'], $col['twitch'], $col['twitter'], $col['facebook'] ],
					$api_key
				);
			}

		foreach ( $rows as $idx => $row ) {
			if ( 0 === ( $idx % 200 ) && function_exists( 'set_time_limit' ) ) {
				@set_time_limit( 0 );
			}
			if ( 0 === $idx ) {
				continue;
			}
			$cells = isset( $row['values'] ) && is_array( $row['values'] ) ? $row['values'] : [];
			if ( empty( $cells ) ) {
				continue;
			}
			$row_count++;
			$total_rows++;

			$title_text = vt_maint_sheet_guess_title( $cells, $col['youtube'], $col['twitch'] );
			$key        = vt_maint_title_key( $title_text );
			if ( '' === $key ) {
				continue;
			}

			$youtube_url = vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['youtube'] ) );
			$twitch_url  = vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['twitch'] ) );
			$debut_raw   = vt_maint_sheet_cell_text( $cells, $col['debut'] );
			$debut_link  = vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['debut'] ) );
			$youtube_sub = vt_maint_parse_int( vt_maint_sheet_cell_text( $cells, $col['yt_subs'] ) );
			$twitch_fol  = vt_maint_parse_int( vt_maint_sheet_cell_text( $cells, $col['tw_followers'] ) );
			$mixed_count = vt_maint_parse_int( vt_maint_sheet_cell_text( $cells, $col['mixed_count'] ) );

			if ( $mixed_count > 0 ) {
				if ( $twitch_fol <= 0 && '' !== $twitch_url ) {
					$twitch_fol = $mixed_count;
				} elseif ( $youtube_sub <= 0 && '' !== $youtube_url ) {
					$youtube_sub = $mixed_count;
				}
			}

			$note = vt_maint_sheet_cell_text( $cells, $col['note'] );
			$life = vt_maint_detect_lifecycle_slug( $note );
			$default_life = (string) ( $spec['default_lifecycle'] ?? 'active' );
			if ( 'active' === $life && 'active' !== $default_life ) {
				$life = $default_life;
			}

			$facebook_url = vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['facebook'] ) );
			$fanpage_url  = vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['fanpage'] ) );
			if ( '' === $facebook_url && '' !== $fanpage_url ) {
				$facebook_url = $fanpage_url;
			}

			$item = [
				'title'            => $title_text,
				'title_key'        => $key,
				'name_sig'         => vt_maint_name_signature( $title_text ),
				'debut_raw'        => $debut_raw,
				'debut_link'       => $debut_link,
				'youtube_sub'      => $youtube_sub,
				'twitch_followers' => $twitch_fol,
				'email'            => sanitize_email( vt_maint_sheet_cell_text( $cells, $col['email'] ) ),
				'affiliation'      => vt_maint_sheet_cell_text( $cells, $col['affiliation'] ),
				'note'             => $note,
				'artist'           => vt_maint_sheet_cell_text( $cells, $col['artist'] ),
				'lifecycle'        => $life,
				'source_gid'       => $gid,
				'source_title'     => $title,
				'source_label'     => (string) ( $spec['label'] ?? '' ),
				'source_slug'      => (string) ( $spec['source_slug'] ?? '' ),
				'origin'           => (string) ( $spec['origin'] ?? 'tw_sheet' ),
				'country_code'     => (string) ( $spec['country_code'] ?? '' ),
				'country_name'     => (string) ( $spec['country_name'] ?? '' ),
				'role_tags'        => is_array( $spec['role_tags'] ) ? $spec['role_tags'] : [],
				'links'            => [
					'vt_youtube_url'  => $youtube_url,
					'vt_twitch_url'   => $twitch_url,
					'vt_bluesky_url'  => vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['bluesky'] ) ),
					'vt_facebook_url' => $facebook_url,
					'vt_twitter_url'  => vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['twitter'] ) ),
					'vt_marshmallow'  => vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['marshmallow'] ) ),
					'vt_donate'       => vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['donate'] ) ),
					'vt_discord'      => vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['discord'] ) ),
					'vt_plurk'        => vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['plurk'] ) ),
					'vt_instagram'    => vt_maint_clean_url( vt_maint_sheet_cell_url( $cells, $col['instagram'] ) ),
				],
			];

			$score = 0;
			foreach ( $item['links'] as $u ) {
				if ( '' !== trim( (string) $u ) ) {
					$score += 6;
				}
			}
			if ( $item['youtube_sub'] > 0 ) {
				$score += 8;
			}
			if ( $item['twitch_followers'] > 0 ) {
				$score += 8;
			}
			$item['score'] = $score;

			$map_key = $key;
			$cjk_sig = (string) ( $item['name_sig']['cjk_key'] ?? '' );
			$lat_sig = (string) ( $item['name_sig']['latin_compact'] ?? '' );
			if ( '' !== $cjk_sig && isset( $sheet_sig_cjk[ $cjk_sig ] ) ) {
				$map_key = (string) $sheet_sig_cjk[ $cjk_sig ];
			} elseif ( '' !== $lat_sig && strlen( $lat_sig ) >= 6 && isset( $sheet_sig_latin[ $lat_sig ] ) ) {
				$map_key = (string) $sheet_sig_latin[ $lat_sig ];
			}
			if ( '' !== $cjk_sig && ! isset( $sheet_sig_cjk[ $cjk_sig ] ) ) {
				$sheet_sig_cjk[ $cjk_sig ] = $map_key;
			}
			if ( '' !== $lat_sig && strlen( $lat_sig ) >= 6 && ! isset( $sheet_sig_latin[ $lat_sig ] ) ) {
				$sheet_sig_latin[ $lat_sig ] = $map_key;
			}

			$exists = isset( $sheet_map[ $map_key ] ) ? $sheet_map[ $map_key ] : null;
			if ( ! $exists || intval( $item['score'] ) >= intval( $exists['score'] ) ) {
				$sheet_map[ $map_key ] = $item;
			}
			$mapped++;
		}

			$source_stats[] = [ 'gid' => $gid, 'label' => (string) ( $spec['label'] ?? '' ), 'title' => $title, 'rows' => $row_count, 'mapped' => $mapped, 'error' => '' ];
			unset( $rows, $rows_res );
			if ( function_exists( 'gc_collect_cycles' ) ) {
				gc_collect_cycles();
			}
		}

	$life_term_ids = [];
	$life_labels = [
		'active'       => '活動中',
		'graduated'    => '已畢業 / 引退',
		'reincarnated' => '轉生 / 前世',
		'hiatus'       => '休止中',
	];
	if ( taxonomy_exists( 'life-status' ) ) {
		foreach ( $life_labels as $slug => $name ) {
			$tid = vt_maint_ensure_term( 'life-status', $name, $slug );
			if ( $tid ) {
				$life_term_ids[ $slug ] = intval( $tid );
			}
		}
	}

	$role_term_ids = [];
	foreach ( $sources as $spec ) {
		$tags = is_array( $spec['role_tags'] ) ? $spec['role_tags'] : [];
		foreach ( $tags as $tag_name ) {
			$tag_name = trim( (string) $tag_name );
			if ( vt_maint_is_excluded_role_tag( $tag_name ) ) {
				continue;
			}
			if ( ! isset( $role_term_ids[ $tag_name ] ) ) {
				$role_term_ids[ $tag_name ] = vt_maint_ensure_term( 'role-tag', $tag_name );
			}
		}
	}
	foreach ( [ '台灣VTuber', '個人勢', '企業勢', '社團勢' ] as $base_role_tag ) {
		if ( ! isset( $role_term_ids[ $base_role_tag ] ) ) {
			$role_term_ids[ $base_role_tag ] = vt_maint_ensure_term( 'role-tag', $base_role_tag );
		}
	}
	$platform_term_ids = [
		'youtube'  => vt_maint_ensure_term( 'platform', 'YouTube', 'youtube' ),
		'twitch'   => vt_maint_ensure_term( 'platform', 'Twitch', 'twitch' ),
		'twitter'  => vt_maint_ensure_term( 'platform', 'X / Twitter', 'x-twitter' ),
		'facebook' => vt_maint_ensure_term( 'platform', 'Facebook', 'facebook' ),
		'bluesky'  => vt_maint_ensure_term( 'platform', 'Bluesky', 'bluesky' ),
	];
	$agency_term_ids = [];

	$existing_by_key       = [];
	$existing_by_youtube   = [];
	$existing_by_twitch    = [];
	$existing_by_email     = [];
	$existing_by_cjk       = [];
	$existing_by_latin     = [];
	$existing_by_token     = [];
	$existing_sig_by_post  = [];
	$q = new WP_Query(
		[
			'post_type'      => 'vtuber',
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'no_found_rows'  => true,
			'cache_results'          => false,
			'update_post_meta_cache' => false,
			'update_post_term_cache' => false,
		]
	);
	$enable_fuzzy_index = $q->have_posts() && count( (array) $q->posts ) <= 6000;
	if ( $q->have_posts() ) {
		$existing_i = 0;
		foreach ( $q->posts as $pid ) {
			$existing_i++;
			$t_key = vt_maint_title_key( (string) get_the_title( $pid ) );
			$d_key = vt_maint_title_key( (string) get_post_meta( $pid, 'vt_display_name', true ) );
			if ( '' !== $t_key ) {
				$existing_by_key[ $t_key ] = intval( $pid );
			}
			if ( '' !== $d_key ) {
				$existing_by_key[ $d_key ] = intval( $pid );
			}
			$yt_url = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_youtube_url', true ) );
			if ( '' !== $yt_url ) {
				$existing_by_youtube[ $yt_url ] = intval( $pid );
			}
			$tw_url = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_twitch_url', true ) );
			if ( '' !== $tw_url ) {
				$existing_by_twitch[ $tw_url ] = intval( $pid );
			}
			$email = sanitize_email( (string) get_post_meta( $pid, 'vt_email', true ) );
			if ( '' !== $email ) {
				if ( ! isset( $existing_by_email[ $email ] ) ) {
					$existing_by_email[ $email ] = [];
				}
				$existing_by_email[ $email ][] = intval( $pid );
			}

			if ( $enable_fuzzy_index ) {
				$sig_title = vt_maint_name_signature( (string) get_the_title( $pid ) );
				$sig_disp  = vt_maint_name_signature( (string) get_post_meta( $pid, 'vt_display_name', true ) );
				$merged_sig = [
					'raw'           => (string) get_the_title( $pid ),
					'base_key'      => (string) ( $sig_title['base_key'] ?? '' ),
					'cjk_key'       => (string) ( $sig_disp['cjk_key'] ?: ( $sig_title['cjk_key'] ?? '' ) ),
					'latin_tokens'  => array_values( array_unique( array_merge( is_array( $sig_title['latin_tokens'] ?? null ) ? $sig_title['latin_tokens'] : [], is_array( $sig_disp['latin_tokens'] ?? null ) ? $sig_disp['latin_tokens'] : [] ) ) ),
					'latin_compact' => '',
				];
				sort( $merged_sig['latin_tokens'] );
				$merged_sig['latin_compact'] = implode( '', $merged_sig['latin_tokens'] );
				vt_maint_index_name_signature( $existing_by_cjk, $existing_by_latin, $existing_by_token, $existing_sig_by_post, $pid, $merged_sig );
			}
			if ( 0 === ( $existing_i % 300 ) && function_exists( 'wp_cache_flush' ) ) {
				@wp_cache_flush();
				if ( function_exists( 'gc_collect_cycles' ) ) {
					gc_collect_cycles();
				}
			}
		}
		wp_reset_postdata();
	}

	$processed            = 0;
	$matched              = 0;
	$created              = 0;
	$updated              = 0;
	$avatar_updates       = 0;
	$touched_ids          = [];
	$unmatched            = [];
	$api_refreshed_yt     = 0;
	$api_refreshed_twitch = 0;
	$missing_avatar       = [];

	foreach ( $sheet_map as $key => $row ) {
		if ( 0 === ( $processed % 150 ) && function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 0 );
		}
		$processed++;
		$post_id = 0;
		$row_sig = isset( $row['name_sig'] ) && is_array( $row['name_sig'] ) ? $row['name_sig'] : vt_maint_name_signature( (string) ( $row['title'] ?? '' ) );
		if ( isset( $existing_by_key[ $key ] ) ) {
			$post_id = intval( $existing_by_key[ $key ] );
		}
		$row_yt = vt_maint_clean_url( (string) ( $row['links']['vt_youtube_url'] ?? '' ) );
		$row_tw = vt_maint_clean_url( (string) ( $row['links']['vt_twitch_url'] ?? '' ) );
		if ( $post_id <= 0 && '' !== $row_yt && isset( $existing_by_youtube[ $row_yt ] ) ) {
			$post_id = intval( $existing_by_youtube[ $row_yt ] );
		}
		if ( $post_id <= 0 && '' !== $row_tw && isset( $existing_by_twitch[ $row_tw ] ) ) {
			$post_id = intval( $existing_by_twitch[ $row_tw ] );
		}
		if ( $post_id <= 0 && '' !== $row['email'] && isset( $existing_by_email[ $row['email'] ] ) && 1 === count( $existing_by_email[ $row['email'] ] ) ) {
			$post_id = intval( $existing_by_email[ $row['email'] ][0] );
		}
		if ( $enable_fuzzy_index && $post_id <= 0 ) {
			$cjk_key = (string) ( $row_sig['cjk_key'] ?? '' );
			if ( '' !== $cjk_key && isset( $existing_by_cjk[ $cjk_key ] ) && 1 === count( $existing_by_cjk[ $cjk_key ] ) ) {
				$post_id = intval( $existing_by_cjk[ $cjk_key ][0] );
			}
		}
		if ( $enable_fuzzy_index && $post_id <= 0 ) {
			$latin_key = (string) ( $row_sig['latin_compact'] ?? '' );
			if ( '' !== $latin_key && strlen( $latin_key ) >= 6 && isset( $existing_by_latin[ $latin_key ] ) && 1 === count( $existing_by_latin[ $latin_key ] ) ) {
				$post_id = intval( $existing_by_latin[ $latin_key ][0] );
			}
		}
		if ( $enable_fuzzy_index && $post_id <= 0 ) {
			$candidates = [];
			$cjk_key    = (string) ( $row_sig['cjk_key'] ?? '' );
			if ( '' !== $cjk_key && isset( $existing_by_cjk[ $cjk_key ] ) ) {
				foreach ( (array) $existing_by_cjk[ $cjk_key ] as $cid ) {
					$candidates[ intval( $cid ) ] = true;
				}
			}
			$tokens = isset( $row_sig['latin_tokens'] ) && is_array( $row_sig['latin_tokens'] ) ? $row_sig['latin_tokens'] : [];
			if ( ! empty( $tokens ) ) {
				usort(
					$tokens,
					function ( $a, $b ) {
						return strlen( (string) $b ) <=> strlen( (string) $a );
					}
				);
				$tokens = array_slice( $tokens, 0, 3 );
				foreach ( $tokens as $token ) {
					if ( isset( $existing_by_token[ $token ] ) ) {
						foreach ( (array) $existing_by_token[ $token ] as $cid ) {
							$candidates[ intval( $cid ) ] = true;
						}
					}
				}
			}
			if ( ! empty( $candidates ) ) {
				$best_id    = 0;
				$best_score = -1;
				$next_score = -1;
				foreach ( array_keys( $candidates ) as $cid ) {
					$sig = isset( $existing_sig_by_post[ $cid ] ) && is_array( $existing_sig_by_post[ $cid ] ) ? $existing_sig_by_post[ $cid ] : vt_maint_name_signature( (string) get_the_title( $cid ) );
					$sc  = vt_maint_name_similarity_score( $row_sig, $sig );
					if ( $sc > $best_score ) {
						$next_score = $best_score;
						$best_score = $sc;
						$best_id    = intval( $cid );
					} elseif ( $sc > $next_score ) {
						$next_score = $sc;
					}
				}
				if ( $best_id > 0 && $best_score >= 6 && ( $best_score - $next_score ) >= 2 ) {
					$post_id = $best_id;
				}
			}
		}

		$is_new = false;
		if ( $post_id <= 0 ) {
			$post_id = wp_insert_post(
				[
					'post_type'    => 'vtuber',
					'post_status'  => 'publish',
					'post_title'   => $row['title'],
					'post_excerpt' => wp_trim_words( (string) $row['note'], 36 ),
				],
				true
			);
			if ( is_wp_error( $post_id ) ) {
				$unmatched[] = [ 'title' => $row['title'], 'error' => $post_id->get_error_message(), 'key' => $key ];
				continue;
			}
			$post_id = intval( $post_id );
			$is_new  = true;
			$created++;
		} else {
			$matched++;
		}

		$touched_ids[ $post_id ] = true;
		$changed = 0;

		$current_title = (string) get_the_title( $post_id );
		if ( $is_new || '' === trim( $current_title ) || false !== strpos( $current_title, '???' ) ) {
			wp_update_post( [ 'ID' => $post_id, 'post_title' => $row['title'] ] );
			$changed++;
		}

		update_post_meta( $post_id, 'vt_data_origin', (string) $row['origin'] );
		update_post_meta( $post_id, 'vt_sheet_source_gid', intval( $row['source_gid'] ) );
		update_post_meta( $post_id, 'vt_sheet_source_label', (string) $row['source_label'] );
		update_post_meta( $post_id, 'vt_sheet_source_slug', (string) $row['source_slug'] );
		update_post_meta( $post_id, 'vt_sheet_source_title', (string) $row['source_title'] );
		update_post_meta( $post_id, 'vt_sheet_synced', 1 );
		update_post_meta( $post_id, 'vt_display_name', (string) $row['title'] );
		update_post_meta( $post_id, 'vt_name_key', (string) ( $row_sig['base_key'] ?? '' ) );
		update_post_meta( $post_id, 'vt_name_cjk_key', (string) ( $row_sig['cjk_key'] ?? '' ) );
		update_post_meta( $post_id, 'vt_name_latin_key', (string) ( $row_sig['latin_compact'] ?? '' ) );

		// Country (sheet sources are authoritative for TW).
		$cc = strtoupper( trim( (string) ( $row['country_code'] ?? '' ) ) );
		$cn = trim( (string) ( $row['country_name'] ?? '' ) );
		if ( '' !== $cc ) {
			update_post_meta( $post_id, 'vt_country_code', $cc );
		}
		if ( '' !== $cn ) {
			update_post_meta( $post_id, 'vt_country_name', $cn );
		}

		foreach ( $row['links'] as $meta_key => $meta_url ) {
			if ( '' === trim( (string) $meta_url ) ) {
				continue;
			}
			$val = (string) $meta_url;
			// Canonicalize core social URLs to reduce duplicate variants across sources.
			if ( in_array( (string) $meta_key, [ 'vt_youtube_url', 'vt_twitch_url', 'vt_twitter_url', 'vt_facebook_url', 'vt_bluesky_url', 'vt_official_url', 'vt_affiliation_url' ], true ) ) {
				$clean = vt_maint_clean_url( $val );
				if ( '' !== $clean ) {
					$val = $clean;
				}
			}
			update_post_meta( $post_id, $meta_key, $val );
			$changed++;
		}

		// Derived handles/IDs for stable de-dupe keys.
		$tw_login = vt_maint_twitch_login_from_url( (string) get_post_meta( $post_id, 'vt_twitch_url', true ) );
		if ( '' !== $tw_login ) {
			update_post_meta( $post_id, 'vt_twitch_login', $tw_login );
		}
		$x_handle = vt_maint_twitter_handle_from_url( (string) get_post_meta( $post_id, 'vt_twitter_url', true ) );
		if ( '' !== $x_handle ) {
			update_post_meta( $post_id, 'vt_twitter_handle', $x_handle );
		}

		if ( '' !== trim( (string) $row['debut_link'] ) ) {
			$current_rep = (string) get_post_meta( $post_id, 'vt_rep_video_url', true );
			if ( '' === trim( $current_rep ) ) {
				update_post_meta( $post_id, 'vt_rep_video_url', (string) $row['debut_link'] );
				$changed++;
			}
		}
		$acf_date = vt_maint_parse_date_for_acf( (string) $row['debut_raw'] );
		if ( '' !== $acf_date ) {
			update_post_meta( $post_id, 'vt_debut_date', $acf_date );
			$changed++;
		}

		// Taxonomy: country + debut year.
		if ( taxonomy_exists( 'country' ) ) {
			$cc_slug = strtolower( sanitize_title( $cc ) );
			$cname   = '' !== $cn ? $cn : ( '' !== $cc ? $cc : '' );
			if ( '' !== $cc_slug && '' !== trim( (string) $cname ) ) {
				$tid = vt_maint_ensure_term( 'country', (string) $cname, $cc_slug );
				if ( $tid ) {
					wp_set_object_terms( $post_id, [ intval( $tid ) ], 'country', false );
				}
			}
		}
		if ( taxonomy_exists( 'debut-year' ) ) {
			$y = 0;
			if ( '' !== $acf_date ) {
				$y = vt_maint_extract_year( $acf_date );
			}
			if ( $y <= 0 ) {
				$y = vt_maint_extract_year( (string) $row['debut_raw'] );
			}
			if ( $y > 0 ) {
				$tid = vt_maint_ensure_term( 'debut-year', (string) $y, (string) $y );
				if ( $tid ) {
					wp_set_object_terms( $post_id, [ intval( $tid ) ], 'debut-year', false );
				}
			}
		}

		if ( intval( $row['youtube_sub'] ) > 0 ) {
			update_post_meta( $post_id, 'vt_youtube_subs', intval( $row['youtube_sub'] ) );
			$changed++;
		}
		if ( intval( $row['twitch_followers'] ) > 0 ) {
			update_post_meta( $post_id, 'vt_twitch_followers', intval( $row['twitch_followers'] ) );
			$changed++;
		}
		if ( '' !== trim( (string) $row['email'] ) ) {
			update_post_meta( $post_id, 'vt_email', (string) $row['email'] );
			$changed++;
		}
		if ( '' !== trim( (string) $row['affiliation'] ) ) {
			update_post_meta( $post_id, 'vt_affiliation', wp_strip_all_tags( (string) $row['affiliation'] ) );
			$changed++;
		}
		if ( '' !== trim( (string) $row['note'] ) ) {
			update_post_meta( $post_id, 'vt_sheet_note', wp_strip_all_tags( (string) $row['note'] ) );
			$current_summary = (string) get_post_meta( $post_id, 'vt_summary', true );
			if ( '' === trim( $current_summary ) ) {
				update_post_meta( $post_id, 'vt_summary', wp_trim_words( wp_strip_all_tags( (string) $row['note'] ), 120 ) );
			}
			$changed++;
		}

		$life_slug = in_array( (string) $row['lifecycle'], [ 'active', 'graduated', 'reincarnated', 'hiatus' ], true ) ? (string) $row['lifecycle'] : 'active';
		update_post_meta( $post_id, 'vt_lifecycle_status', $life_slug );
		if ( isset( $life_term_ids[ $life_slug ] ) ) {
			wp_set_object_terms( $post_id, [ intval( $life_term_ids[ $life_slug ] ) ], 'life-status', false );
		}

		$platform_ids = [];
		if ( '' !== trim( (string) $row['links']['vt_youtube_url'] ) && ! empty( $platform_term_ids['youtube'] ) ) {
			$platform_ids[] = intval( $platform_term_ids['youtube'] );
		}
		if ( '' !== trim( (string) $row['links']['vt_twitch_url'] ) && ! empty( $platform_term_ids['twitch'] ) ) {
			$platform_ids[] = intval( $platform_term_ids['twitch'] );
		}
		if ( '' !== trim( (string) $row['links']['vt_twitter_url'] ) && ! empty( $platform_term_ids['twitter'] ) ) {
			$platform_ids[] = intval( $platform_term_ids['twitter'] );
		}
		if ( '' !== trim( (string) $row['links']['vt_facebook_url'] ) && ! empty( $platform_term_ids['facebook'] ) ) {
			$platform_ids[] = intval( $platform_term_ids['facebook'] );
		}
		if ( '' !== trim( (string) $row['links']['vt_bluesky_url'] ) && ! empty( $platform_term_ids['bluesky'] ) ) {
			$platform_ids[] = intval( $platform_term_ids['bluesky'] );
		}
		if ( ! empty( $platform_ids ) ) {
			wp_set_object_terms( $post_id, array_values( array_unique( $platform_ids ) ), 'platform', false );
		}

		$append_roles = [];
		if ( ! empty( $row['role_tags'] ) && is_array( $row['role_tags'] ) ) {
			foreach ( $row['role_tags'] as $tag_name ) {
				if ( vt_maint_is_excluded_role_tag( $tag_name ) ) {
					continue;
				}
				$tid = isset( $role_term_ids[ $tag_name ] ) ? intval( $role_term_ids[ $tag_name ] ) : 0;
				if ( $tid > 0 ) {
					$append_roles[] = $tid;
				}
			}
		}
		$aff_norm = vt_maint_lower( (string) $row['affiliation'] );
		if ( '' !== $aff_norm ) {
			if ( false !== strpos( $aff_norm, '個人' ) || false !== strpos( $aff_norm, 'indie' ) ) {
				$tid = isset( $role_term_ids['個人勢'] ) ? intval( $role_term_ids['個人勢'] ) : 0;
				if ( $tid > 0 ) {
					$append_roles[] = $tid;
				}
			}
			if ( false !== strpos( $aff_norm, '企業' ) || false !== strpos( $aff_norm, '公司' ) || false !== strpos( $aff_norm, '事務所' ) ) {
				$tid = isset( $role_term_ids['企業勢'] ) ? intval( $role_term_ids['企業勢'] ) : 0;
				if ( $tid > 0 ) {
					$append_roles[] = $tid;
				}
			}
			if ( false !== strpos( $aff_norm, '社團' ) || false !== strpos( $aff_norm, '同人' ) ) {
				$tid = isset( $role_term_ids['社團勢'] ) ? intval( $role_term_ids['社團勢'] ) : 0;
				if ( $tid > 0 ) {
					$append_roles[] = $tid;
				}
			}
		}
		if ( ! empty( $append_roles ) ) {
			wp_set_object_terms( $post_id, array_values( array_unique( $append_roles ) ), 'role-tag', true );
		}

		if ( taxonomy_exists( 'agency' ) ) {
			$aff_name = trim( wp_strip_all_tags( (string) $row['affiliation'] ) );
			if ( '' !== $aff_name && ! in_array( vt_maint_lower( $aff_name ), [ '個人', 'indie', '個人勢' ], true ) ) {
				if ( ! array_key_exists( $aff_name, $agency_term_ids ) ) {
					$agency_term_ids[ $aff_name ] = intval( vt_maint_ensure_term( 'agency', $aff_name ) );
				}
				if ( ! empty( $agency_term_ids[ $aff_name ] ) ) {
					wp_set_object_terms( $post_id, [ intval( $agency_term_ids[ $aff_name ] ) ], 'agency', false );
				}
			}
		}

		$need_thumb      = vt_maint_post_needs_thumbnail( $post_id );
		$has_yt_url      = '' !== trim( (string) $row['links']['vt_youtube_url'] );
		$has_twitch_url  = '' !== trim( (string) $row['links']['vt_twitch_url'] );
		$has_any_social  = vt_maint_post_has_any_social_url( $post_id );
		$current_yt_subs = intval( get_post_meta( $post_id, 'vt_youtube_subs', true ) );
		$current_tw_fol  = intval( get_post_meta( $post_id, 'vt_twitch_followers', true ) );
		$summary_now     = (string) get_post_meta( $post_id, 'vt_summary', true );
		$summary_needs   = vt_maint_summary_needs_enrich( $summary_now );

		if ( $has_yt_url && ( $need_thumb || $current_yt_subs <= 0 ) ) {
			$yt_cid = vt_maint_resolve_youtube_channel_id( (string) $row['links']['vt_youtube_url'], $api_key );
			if ( '' !== trim( (string) $yt_cid ) ) {
				update_post_meta( $post_id, 'vt_youtube_channel_id', (string) $yt_cid );
			}
			$yt     = vt_maint_fetch_youtube_meta( $yt_cid, $api_key );
			if ( ! empty( $yt['subs'] ) && $current_yt_subs <= 0 ) {
				update_post_meta( $post_id, 'vt_youtube_subs', intval( $yt['subs'] ) );
				$api_refreshed_yt++;
				$changed++;
			}
			if ( $summary_needs && ! empty( $yt['summary'] ) ) {
				update_post_meta( $post_id, 'vt_summary', wp_trim_words( wp_strip_all_tags( (string) $yt['summary'] ), 120 ) );
				update_post_meta( $post_id, 'vt_summary_source', 'youtube_api' );
				$summary_needs = false;
				$changed++;
			}
			if ( $need_thumb && ! empty( $yt['avatar'] ) ) {
				if ( vt_maint_set_thumbnail_from_url( $post_id, (string) $yt['avatar'] ) > 0 ) {
					$avatar_updates++;
					$need_thumb = false;
					$changed++;
				}
			}
		}

		if ( $has_twitch_url && ( $need_thumb || $current_tw_fol <= 0 || $summary_needs ) ) {
			$t_meta = vt_maint_fetch_twitch_meta( (string) $row['links']['vt_twitch_url'] );
			if ( ! empty( $t_meta['followers'] ) && $current_tw_fol <= 0 ) {
				update_post_meta( $post_id, 'vt_twitch_followers', intval( $t_meta['followers'] ) );
				$api_refreshed_twitch++;
				$changed++;
			}
			if ( $need_thumb && ! empty( $t_meta['avatar'] ) ) {
				if ( vt_maint_set_thumbnail_from_url( $post_id, (string) $t_meta['avatar'] ) > 0 ) {
					$avatar_updates++;
					$need_thumb = false;
					$changed++;
				}
			}
			if ( $summary_needs && ! empty( $t_meta['summary'] ) ) {
				update_post_meta( $post_id, 'vt_summary', wp_trim_words( wp_strip_all_tags( (string) $t_meta['summary'] ), 120 ) );
				update_post_meta( $post_id, 'vt_summary_source', 'twitch_api' );
				$summary_needs = false;
				$changed++;
			}
		}
		if ( $summary_needs && $has_any_social ) {
			$best = vt_maint_pick_best_social_summary( $post_id, $api_key );
			$sum  = trim( (string) ( $best['summary'] ?? '' ) );
			if ( '' !== $sum ) {
				update_post_meta( $post_id, 'vt_summary', $sum );
				update_post_meta( $post_id, 'vt_summary_source', (string) ( $best['source'] ?? 'social_meta' ) );
				update_post_meta( $post_id, 'vt_summary_refreshed_utc', gmdate( 'c' ) );
				$summary_needs = false;
				$changed++;
			}
		}
		if ( $need_thumb ) {
			$social_candidates = vt_maint_social_avatar_candidates( $post_id );
			if ( ! empty( $social_candidates ) ) {
				foreach ( $social_candidates as $cand ) {
					$u = (string) ( $cand['url'] ?? '' );
					if ( '' === $u ) {
						continue;
					}
					if ( vt_maint_set_thumbnail_from_url( $post_id, $u ) > 0 ) {
						$avatar_updates++;
						$need_thumb = false;
						$changed++;
						break;
					}
				}
			}
		}

		if ( $changed > 0 ) {
			$updated++;
		}
		if ( vt_maint_post_needs_thumbnail( $post_id ) ) {
			$missing_avatar[] = [
				'id'        => intval( $post_id ),
				'title'     => (string) get_the_title( $post_id ),
				'source'    => (string) ( $row['source_label'] ?? '' ),
				'youtube'   => (string) ( $row['links']['vt_youtube_url'] ?? '' ),
				'twitch'    => (string) ( $row['links']['vt_twitch_url'] ?? '' ),
				'twitter'   => (string) ( $row['links']['vt_twitter_url'] ?? '' ),
				'facebook'  => (string) ( $row['links']['vt_facebook_url'] ?? '' ),
				'updatedAt' => gmdate( 'c' ),
			];
		}

		$existing_by_key[ $key ] = $post_id;
		$yt_u = vt_maint_clean_url( (string) ( $row['links']['vt_youtube_url'] ?? '' ) );
		if ( '' !== $yt_u ) {
			$existing_by_youtube[ $yt_u ] = $post_id;
		}
		$tw_u = vt_maint_clean_url( (string) ( $row['links']['vt_twitch_url'] ?? '' ) );
		if ( '' !== $tw_u ) {
			$existing_by_twitch[ $tw_u ] = $post_id;
		}
		if ( '' !== (string) $row['email'] ) {
			$em = (string) $row['email'];
			if ( ! isset( $existing_by_email[ $em ] ) ) {
				$existing_by_email[ $em ] = [];
			}
			$existing_by_email[ $em ][] = $post_id;
			$existing_by_email[ $em ]   = array_values( array_unique( array_map( 'intval', $existing_by_email[ $em ] ) ) );
		}
		if ( $enable_fuzzy_index ) {
			vt_maint_index_name_signature( $existing_by_cjk, $existing_by_latin, $existing_by_token, $existing_sig_by_post, $post_id, $row_sig );
		}
	}

	$stale = [];
	$q_stale = new WP_Query(
		[
			'post_type'      => 'vtuber',
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'no_found_rows'  => true,
			'meta_query'     => [
				[
					'key'   => 'vt_data_origin',
					'value' => 'tw_sheet',
				],
			],
		]
	);
	if ( $q_stale->have_posts() ) {
		foreach ( $q_stale->posts as $pid ) {
			if ( isset( $touched_ids[ $pid ] ) ) {
				continue;
			}
			update_post_meta( $pid, 'vt_sheet_synced', 0 );
			$stale[] = [ 'id' => intval( $pid ), 'title' => (string) get_the_title( $pid ) ];
		}
		wp_reset_postdata();
	}

	$summary = [
		'ok'                 => 1,
		'spreadsheet_id'     => $spreadsheet_id,
		'rows'               => $total_rows,
		'mapped'             => count( $sheet_map ),
		'processed'          => $processed,
		'matched_existing'   => $matched,
		'created'            => $created,
		'updated'            => $updated,
		'avatar_updates'     => $avatar_updates,
		'api_refreshed_yt'   => $api_refreshed_yt,
		'api_refreshed_tw'   => $api_refreshed_twitch,
		'unmatched'          => count( $unmatched ),
		'stale'              => count( $stale ),
		'missing_avatar'     => count( $missing_avatar ),
		'fuzzy_index'        => $enable_fuzzy_index ? 'enabled' : 'disabled_large_dataset',
		'cursor_start'       => intval( $cursor_start ),
		'cursor_next'        => intval( $cursor_next ),
		'sources_total'      => intval( $total_sources ),
		'sources_this_run'   => count( (array) $sources ),
		'sources'            => $source_stats,
		'utc'                => gmdate( 'c' ),
	];
	$summary['post_sync_note'] = 'translations_and_dedupe_run_separately';

	$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
	if ( ! is_dir( $dir ) ) {
		wp_mkdir_p( $dir );
	}
	@file_put_contents( $dir . 'sheet-sync-last.json', wp_json_encode( $summary, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
	@file_put_contents( $dir . 'sheet-sync-unmatched.json', wp_json_encode( $unmatched, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
	@file_put_contents( $dir . 'sheet-sync-stale.json', wp_json_encode( $stale, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
	@file_put_contents( $dir . 'sheet-sync-sources.json', wp_json_encode( $source_stats, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
	@file_put_contents( $dir . 'sheet-sync-missing-avatar.json', wp_json_encode( $missing_avatar, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );

	vt_maint_log(
		'sync_sheet rows=' . $total_rows .
		' mapped=' . count( $sheet_map ) .
		' matched=' . $matched .
		' created=' . $created .
		' updated=' . $updated .
		' avatar=' . $avatar_updates .
		' missing_avatar=' . count( $missing_avatar ) .
		' unmatched=' . count( $unmatched ) .
		' stale=' . count( $stale )
	);
	return $summary;
	} catch ( Throwable $e ) {
		vt_maint_log( 'sync_sheet fatal=' . $e->getMessage() );
		return [
			'ok'    => 0,
			'error' => 'sync_sheet_exception',
			'msg'   => $e->getMessage(),
		];
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_extract_first_match( $pattern, $text ) {
	$m = [];
	if ( preg_match( $pattern, (string) $text, $m ) ) {
		return isset( $m[0] ) ? trim( (string) $m[0] ) : '';
	}
	return '';
}

function vt_maint_resolve_youtube_channel_id( $youtube_url, $api_key ) {
	$url = (string) $youtube_url;
	if ( '' === $url || '' === $api_key ) {
		return '';
	}
	$cache_key = 'vt_maint_yt_cid_' . md5( $url );
	$cached    = get_transient( $cache_key );
	if ( '' !== trim( (string) $cached ) ) {
		return (string) $cached;
	}
	if ( preg_match( '#/channel/([A-Za-z0-9_-]+)#', $url, $m ) ) {
		$cid = (string) $m[1];
		set_transient( $cache_key, $cid, DAY_IN_SECONDS );
		return $cid;
	}
	if ( preg_match( '#/@([^/?]+)#', $url, $m ) ) {
		$handle = $m[1];
		$res = wp_remote_get(
			add_query_arg(
				[
					'part'       => 'id',
					'forHandle'  => $handle,
					'key'        => $api_key,
					'maxResults' => 1,
				],
				'https://www.googleapis.com/youtube/v3/channels'
			),
			[ 'timeout' => 12 ]
		);
		if ( is_wp_error( $res ) ) {
			return '';
		}
		$data = json_decode( wp_remote_retrieve_body( $res ), true );
		$cid  = (string) ( $data['items'][0]['id'] ?? '' );
		if ( '' !== $cid ) {
			set_transient( $cache_key, $cid, DAY_IN_SECONDS );
		}
		if ( '' !== $cid ) {
			return $cid;
		}

		// Fallback A: Search API by handle text.
		$search = wp_remote_get(
			add_query_arg(
				[
					'part'       => 'snippet',
					'type'       => 'channel',
					'q'          => $handle,
					'maxResults' => 1,
					'key'        => $api_key,
				],
				'https://www.googleapis.com/youtube/v3/search'
			),
			[ 'timeout' => 12 ]
		);
		if ( ! is_wp_error( $search ) ) {
			$sdata = json_decode( wp_remote_retrieve_body( $search ), true );
			$cid   = (string) ( $sdata['items'][0]['snippet']['channelId'] ?? ( $sdata['items'][0]['id']['channelId'] ?? '' ) );
			if ( '' !== $cid ) {
				set_transient( $cache_key, $cid, DAY_IN_SECONDS );
				return $cid;
			}
		}
	}
	if ( preg_match( '#/user/([^/?]+)#', $url, $m ) ) {
		$res = wp_remote_get(
			add_query_arg(
				[
					'part'        => 'id',
					'forUsername' => $m[1],
					'key'         => $api_key,
					'maxResults'  => 1,
				],
				'https://www.googleapis.com/youtube/v3/channels'
			),
			[ 'timeout' => 12 ]
		);
		if ( ! is_wp_error( $res ) ) {
			$data = json_decode( wp_remote_retrieve_body( $res ), true );
			$cid  = (string) ( $data['items'][0]['id'] ?? '' );
			if ( '' !== $cid ) {
				set_transient( $cache_key, $cid, DAY_IN_SECONDS );
				return $cid;
			}
		}
	}

	// Last fallback: oEmbed may return author_url with /channel/{id}.
	$oembed = wp_remote_get(
		add_query_arg(
			[
				'url'    => $url,
				'format' => 'json',
			],
			'https://www.youtube.com/oembed'
		),
		[ 'timeout' => 12 ]
	);
	if ( ! is_wp_error( $oembed ) ) {
		$data = json_decode( wp_remote_retrieve_body( $oembed ), true );
		$author_url = (string) ( $data['author_url'] ?? '' );
		if ( preg_match( '#/channel/([A-Za-z0-9_-]+)#', $author_url, $m ) ) {
			$cid = (string) $m[1];
			set_transient( $cache_key, $cid, DAY_IN_SECONDS );
			return $cid;
		}
	}

	// Last fallback B: parse watchable page for channelId marker.
	$page = wp_remote_get(
		$url,
		[
			'timeout'     => 12,
			'redirection' => 3,
			'headers'     => [
				'User-Agent'      => 'vt-maint/1.4 (+usadanews.com)',
				'Accept-Language' => 'en-US,en;q=0.8',
			],
		]
	);
	if ( ! is_wp_error( $page ) ) {
		$html = (string) wp_remote_retrieve_body( $page );
		if ( preg_match( '/\"channelId\"\\s*:\\s*\"(UC[0-9A-Za-z_-]{20,40})\"/', $html, $m ) ) {
			$cid = (string) ( $m[1] ?? '' );
			if ( '' !== $cid ) {
				set_transient( $cache_key, $cid, DAY_IN_SECONDS );
				return $cid;
			}
		}
	}
	return '';
}

function vt_maint_fetch_youtube_meta( $channel_id, $api_key ) {
	if ( '' === $channel_id || '' === $api_key ) {
		return [];
	}
	$cache_key = 'vt_maint_yt_meta_' . md5( $channel_id );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) && ! empty( $cached ) ) {
		return $cached;
	}
	$res = wp_remote_get(
		add_query_arg(
			[
				'part' => 'snippet,statistics',
				'id'   => $channel_id,
				'key'  => $api_key,
			],
			'https://www.googleapis.com/youtube/v3/channels'
		),
		[ 'timeout' => 12 ]
	);
	if ( is_wp_error( $res ) ) {
		return [];
	}
	$data = json_decode( wp_remote_retrieve_body( $res ), true );
	$item = $data['items'][0] ?? [];
	$thumbs = $item['snippet']['thumbnails'] ?? [];
	$summary = trim( (string) ( $item['snippet']['description'] ?? '' ) );
	$out = [
		'subs'   => intval( $item['statistics']['subscriberCount'] ?? 0 ),
		'avatar' => (string) ( $thumbs['high']['url'] ?? ( $thumbs['medium']['url'] ?? ( $thumbs['default']['url'] ?? '' ) ) ),
		'summary'=> $summary,
	];
	if ( ! empty( $out ) ) {
		set_transient( $cache_key, $out, DAY_IN_SECONDS );
	}
	return $out;
}

function vt_maint_import_fandom_global_run( $limit = 30 ) {
	$lock_key = 'vt_maint_import_fandom_global_lock';
	if ( get_transient( $lock_key ) ) {
		return [ 'locked' => 1 ];
	}
	set_transient( $lock_key, 1, 900 );

	$limit = max( 8, min( 80, intval( $limit ) ) );
	$categories = [
		'Category:Hololive'  => 'Hololive',
		'Category:Nijisanji' => 'NIJISANJI',
		'Category:VShojo'    => 'VShojo',
	];

	$agency_ids = [];
	foreach ( $categories as $cat => $agency_name ) {
		$agency_ids[ $agency_name ] = vt_maint_ensure_term( 'agency', $agency_name );
	}
	$yt_term_id = vt_maint_ensure_term( 'platform', 'YouTube', 'youtube' );
	$tw_term_id = vt_maint_ensure_term( 'platform', 'Twitch', 'twitch' );
	$life_active = vt_maint_ensure_term( 'life-status', '活動中', 'active' );

	$existing_by_key = [];
	$q = new WP_Query(
		[
			'post_type'      => 'vtuber',
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'no_found_rows'  => true,
		]
	);
	if ( $q->have_posts() ) {
		foreach ( $q->posts as $pid ) {
			$k1 = vt_maint_title_key( (string) get_the_title( $pid ) );
			$k2 = vt_maint_title_key( (string) get_post_meta( $pid, 'vt_display_name', true ) );
			if ( '' !== $k1 ) {
				$existing_by_key[ $k1 ] = intval( $pid );
			}
			if ( '' !== $k2 ) {
				$existing_by_key[ $k2 ] = intval( $pid );
			}
		}
		wp_reset_postdata();
	}

	$collected = [];
	$seed_file = WP_CONTENT_DIR . '/uploads/vt-logs/global-fandom-seed.json';
	if ( file_exists( $seed_file ) ) {
		$seed_json = json_decode( (string) file_get_contents( $seed_file ), true );
		if ( is_array( $seed_json ) ) {
			foreach ( $seed_json as $item ) {
				if ( count( $collected ) >= $limit ) {
					break;
				}
				$title = trim( (string) ( $item['title'] ?? '' ) );
				if ( '' === $title ) {
					continue;
				}
				$collected[] = [
					'title'      => $title,
					'agency'     => (string) ( $item['agency'] ?? '' ),
					'youtube'    => (string) ( $item['youtube_url'] ?? '' ),
					'twitch'     => (string) ( $item['twitch_url'] ?? '' ),
					'twitter'    => (string) ( $item['twitter_url'] ?? '' ),
					'summary'    => (string) ( $item['summary'] ?? '' ),
					'source_url' => (string) ( $item['source_url'] ?? '' ),
				];
			}
		}
	}

	$yt_api_key = defined( 'VT_YT_API_KEY' ) ? VT_YT_API_KEY : get_option( 'vt_youtube_api_key', '' );

	$processed = 0;
	$created = 0;
	$updated = 0;
	$skipped = 0;

	foreach ( $collected as $seed ) {
		$title = (string) $seed['title'];
		$agency_name = (string) $seed['agency'];
		$key = vt_maint_title_key( $title );
		if ( '' === $key ) {
			$skipped++;
			continue;
		}
		$processed++;

		$youtube = (string) ( $seed['youtube'] ?? '' );
		$twitch  = (string) ( $seed['twitch'] ?? '' );
		$twitter = (string) ( $seed['twitter'] ?? '' );
		$extract = (string) ( $seed['summary'] ?? '' );
		$source_url = (string) ( $seed['source_url'] ?? '' );

		if ( '' === $youtube && '' === $twitch ) {
			$skipped++;
			continue;
		}

		$post_id = isset( $existing_by_key[ $key ] ) ? intval( $existing_by_key[ $key ] ) : 0;
		$is_new = false;
		if ( $post_id <= 0 ) {
			$post_id = wp_insert_post(
				[
					'post_type'    => 'vtuber',
					'post_status'  => 'publish',
					'post_title'   => $title,
					'post_excerpt' => wp_trim_words( $extract, 40 ),
					'post_content' => '',
				],
				true
			);
			if ( is_wp_error( $post_id ) ) {
				$skipped++;
				continue;
			}
			$post_id = intval( $post_id );
			$is_new = true;
			$existing_by_key[ $key ] = $post_id;
			update_post_meta( $post_id, 'vt_data_origin', 'global_import' );
		}

		update_post_meta( $post_id, 'vt_display_name', $title );
		update_post_meta( $post_id, 'vt_affiliation', $agency_name );
		update_post_meta( $post_id, 'vt_sheet_synced', 0 );
		update_post_meta( $post_id, 'vt_source_url', $source_url ?: ( 'https://virtualyoutuber.fandom.com/wiki/' . rawurlencode( str_replace( ' ', '_', $title ) ) ) );
		if ( '' !== $youtube ) {
			update_post_meta( $post_id, 'vt_youtube_url', $youtube );
		}
		if ( '' !== $twitch ) {
			update_post_meta( $post_id, 'vt_twitch_url', $twitch );
		}
		if ( '' !== $twitter ) {
			update_post_meta( $post_id, 'vt_twitter_url', $twitter );
		}
		if ( '' !== trim( $extract ) && '' === trim( (string) get_post_meta( $post_id, 'vt_summary', true ) ) ) {
			update_post_meta( $post_id, 'vt_summary', wp_trim_words( wp_strip_all_tags( $extract ), 90 ) );
		}

		$term_ids = [];
		if ( ! empty( $agency_ids[ $agency_name ] ) ) {
			$term_ids[] = intval( $agency_ids[ $agency_name ] );
		}
		if ( ! empty( $term_ids ) ) {
			wp_set_object_terms( $post_id, $term_ids, 'agency', false );
		}

		$platform_ids = [];
		if ( '' !== $youtube && $yt_term_id ) {
			$platform_ids[] = intval( $yt_term_id );
		}
		if ( '' !== $twitch && $tw_term_id ) {
			$platform_ids[] = intval( $tw_term_id );
		}
		if ( ! empty( $platform_ids ) ) {
			wp_set_object_terms( $post_id, $platform_ids, 'platform', false );
		}

		update_post_meta( $post_id, 'vt_lifecycle_status', 'active' );
		if ( $life_active ) {
			wp_set_object_terms( $post_id, [ intval( $life_active ) ], 'life-status', false );
		}

		if ( '' !== $youtube ) {
			$cid = vt_maint_resolve_youtube_channel_id( $youtube, (string) $yt_api_key );
			$meta = vt_maint_fetch_youtube_meta( $cid, (string) $yt_api_key );
			if ( ! empty( $meta['subs'] ) ) {
				update_post_meta( $post_id, 'vt_youtube_subs', intval( $meta['subs'] ) );
			}
			if ( ! has_post_thumbnail( $post_id ) && ! empty( $meta['avatar'] ) ) {
				vt_maint_set_thumbnail_from_url( $post_id, (string) $meta['avatar'] );
			}
		}

		if ( $is_new ) {
			$created++;
		} else {
			$updated++;
		}
	}

	$result = [
		'ok'        => 1,
		'processed' => $processed,
		'created'   => $created,
		'updated'   => $updated,
		'skipped'   => $skipped,
		'source'    => 'virtualyoutuber.fandom.com',
		'utc'       => gmdate( 'c' ),
	];

	$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
	if ( ! is_dir( $dir ) ) {
		wp_mkdir_p( $dir );
	}
	@file_put_contents( $dir . 'global-import-last.json', wp_json_encode( $result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );
	vt_maint_log( 'global_import processed=' . $processed . ' created=' . $created . ' updated=' . $updated . ' skipped=' . $skipped );
	delete_transient( $lock_key );
	return $result;
}

/**
 * Remove placeholder/broken terms created by earlier imports (e.g. "?? Singer").
 * Conservative: only deletes terms containing literal '?'.
 */
function vt_maint_cleanup_bad_terms_run() {
	$taxes = [ 'agency', 'platform', 'role-tag' ];
	$deleted = 0;
	$skipped = 0;

	foreach ( $taxes as $tax ) {
		$terms = get_terms(
			[
				'taxonomy'   => $tax,
				'hide_empty' => false,
			]
		);
		if ( empty( $terms ) || is_wp_error( $terms ) ) {
			continue;
		}

		foreach ( $terms as $t ) {
			$name = isset( $t->name ) ? (string) $t->name : '';
			$slug = isset( $t->slug ) ? (string) $t->slug : '';
			if ( '' === $name ) {
				continue;
			}
			if ( false === strpos( $name, '?' ) ) {
				continue;
			}
			// Never touch the stable "indie" slug.
			if ( 'agency' === $tax && 'indie' === $slug ) {
				$skipped++;
				continue;
			}
			$r = wp_delete_term( intval( $t->term_id ), $tax );
			if ( is_wp_error( $r ) ) {
				$skipped++;
				continue;
			}
			$deleted++;
		}
	}

	vt_maint_log( "cleanup_terms deleted=$deleted skipped=$skipped" );
	$norm = vt_maint_normalize_terms_run();
	return [ 'deleted' => $deleted, 'skipped' => $skipped, 'normalized' => $norm ];
}

/**
 * Normalize core/SEO terms (fix garbled encodings, rename legacy English tag names, ensure stable slugs).
 * This is intentionally conservative: rename only known slugs / known names.
 */
function vt_maint_normalize_terms_run() {
	$changed = 0;
	$errors  = [];

	$by_slug = [
		[ 'role-tag', 'indie', '個人勢' ],
		[ 'platform', 'youtube', 'YouTube' ],
		[ 'platform', 'twitch', 'Twitch' ],
		[ 'platform', 'x-twitter', 'X / Twitter' ],
		[ 'platform', 'facebook', 'Facebook' ],
		[ 'platform', 'bluesky', 'Bluesky' ],
		[ 'life-status', 'active', '活動中' ],
		[ 'life-status', 'hiatus', '休止中' ],
		[ 'life-status', 'graduated', '已畢業 / 引退' ],
		[ 'life-status', 'reincarnated', '轉生 / 前世' ],
		[ 'country', 'tw', '台灣' ],
	];

	foreach ( $by_slug as $spec ) {
		$tax  = (string) $spec[0];
		$slug = (string) $spec[1];
		$name = (string) $spec[2];
		if ( ! taxonomy_exists( $tax ) ) {
			continue;
		}
		$term = get_term_by( 'slug', $slug, $tax );
		if ( ! $term || is_wp_error( $term ) ) {
			continue;
		}
		if ( (string) $term->name !== $name ) {
			$r = wp_update_term( intval( $term->term_id ), $tax, [ 'name' => $name ] );
			if ( is_wp_error( $r ) ) {
				$errors[] = [ 'tax' => $tax, 'slug' => $slug, 'err' => $r->get_error_message() ];
			} else {
				$changed++;
			}
		}
	}

	$rename_role_by_name = [
		'Taiwan VTuber'      => '台灣VTuber',
		'Preparing'          => '準備中',
		'Unofficial Debut'   => '非正式出道',
		'Archived'           => '封存',
		'Hiatus'             => '休止中',
		'Music'              => '音樂',
		'Video'              => '影片勢',
		'Twitch'             => 'Twitch主',
	];

	if ( taxonomy_exists( 'role-tag' ) ) {
		$terms = get_terms(
			[
				'taxonomy'   => 'role-tag',
				'hide_empty' => false,
			]
		);
		if ( is_array( $terms ) && ! empty( $terms ) ) {
			foreach ( $terms as $t ) {
				if ( ! $t || is_wp_error( $t ) ) {
					continue;
				}
				$cur = trim( (string) $t->name );
				if ( '' === $cur ) {
					continue;
				}
				foreach ( $rename_role_by_name as $from => $to ) {
					if ( 0 === strcasecmp( $cur, (string) $from ) ) {
						if ( $cur !== $to ) {
							$r = wp_update_term( intval( $t->term_id ), 'role-tag', [ 'name' => (string) $to ] );
							if ( is_wp_error( $r ) ) {
								$errors[] = [ 'tax' => 'role-tag', 'slug' => (string) $t->slug, 'err' => $r->get_error_message() ];
							} else {
								$changed++;
							}
						}
						break;
					}
				}
			}
		}
	}

	// Ensure stable slugs exist for SEO collection pages.
	if ( taxonomy_exists( 'role-tag' ) ) {
		vt_maint_ensure_term( 'role-tag', '台灣VTuber', 'taiwan-vtuber' );
		vt_maint_ensure_term( 'role-tag', '個人勢', 'indie' );
	}

	vt_maint_log( 'normalize_terms changed=' . intval( $changed ) . ' errors=' . intval( count( $errors ) ) );
	return [
		'changed' => intval( $changed ),
		'errors'  => array_slice( $errors, 0, 20 ),
	];
}

// Admin tool: add submenu under Tools to force run and view stats.
add_action( 'admin_menu', function () {
	add_management_page( 'VT Maint Runner', 'VT Maint Runner', 'manage_options', 'vt-maint-runner', 'vt_maint_runner_page_v2' );
} );

function vt_maint_runner_page_v2() {
	if ( isset( $_POST['vt_maint_run'] ) && check_admin_referer( 'vt_maint_run' ) ) {
		vt_maint_fillthumbs_run();
		echo '<div class="updated"><p>手動補齊縮圖任務已執行。</p></div>';
	}
	if ( isset( $_POST['vt_maint_enrich'] ) && check_admin_referer( 'vt_maint_run' ) ) {
		vt_maint_enrich_terms_run();
		echo '<div class="updated"><p>手動分類補齊任務已執行。</p></div>';
	}
	if ( isset( $_POST['vt_maint_sync_sheet'] ) && check_admin_referer( 'vt_maint_run' ) ) {
		vt_maint_sync_sheet_run();
		echo '<div class="updated"><p>Google Sheet 同步任務已執行。</p></div>';
	}

	$total = wp_count_posts( 'vtuber' )->publish;
	$missing = new WP_Query(
		[
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
		]
	);
	?>
	<div class="wrap">
		<h1>VT Maint Runner</h1>
		<p>VTuber 總數：<?php echo esc_html( $total ); ?>，缺少首圖：<?php echo esc_html( $missing->found_posts ); ?></p>
		<form method="post">
			<?php wp_nonce_field( 'vt_maint_run' ); ?>
			<p><input type="submit" class="button button-primary" name="vt_maint_run" value="立即補齊縮圖 (20 筆)" /></p>
			<p><input type="submit" class="button" name="vt_maint_enrich" value="立即補齊分類 (50 筆)" /></p>
			<p><input type="submit" class="button" name="vt_maint_sync_sheet" value="立即同步 Google Sheet" /></p>
		</form>
		<p>日誌：/wp-content/uploads/vt-logs/maint-runner.log</p>
	</div>
	<?php
}

function vt_maint_runner_page() {
	if ( isset( $_POST['vt_maint_run'] ) && check_admin_referer( 'vt_maint_run' ) ) {
		vt_maint_fillthumbs_run();
		echo '<div class="updated"><p>已手動執行補圖。</p></div>';
	}
	if ( isset( $_POST['vt_maint_enrich'] ) && check_admin_referer( 'vt_maint_run' ) ) {
		vt_maint_enrich_terms_run();
		echo '<div class="updated"><p>已手動執行標籤補齊。</p></div>';
	}
	$total = wp_count_posts( 'vtuber' )->publish;
	$missing = new WP_Query( [
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
	] );
	?>
	<div class="wrap"><h1>VT Maint Runner</h1>
	<p>VTuber 總數：<?php echo esc_html( $total ); ?>，缺封面：<?php echo esc_html( $missing->found_posts ); ?></p>
	<form method="post">
		<?php wp_nonce_field( 'vt_maint_run' ); ?>
		<p><input type="submit" class="button button-primary" name="vt_maint_run" value="立即執行補圖 (20 筆)" /></p>
		<p><input type="submit" class="button" name="vt_maint_enrich" value="立即執行標籤補齊 (50 筆)" /></p>
	</form>
	<p>日誌：wp-content/uploads/vt-logs/maint-runner.log</p>
	</div>
	<?php
}

// ---------------------------
// HoloList Sync (Non-TW only)
// ---------------------------

function vt_maint_hololist_reserved_paths() {
	// First path segment reserved by hololist for navigation/pages, not VTuber profiles.
	return [
		'top',
		'newest',
		'latest',
		'upcoming',
		'random',
		'type',
		'category',
		'content',
		'group',
		'gender',
		'zodiac',
		'language',
		'model',
		'tag',
		'birthday',
		'debut',
		'retirement',
		'gallery',
		'news',
		'event',
		'events',
		'about',
		'announcement',
		'contact',
		'donate',
		'cookie-policy',
		'privacy-policy',
		'terms-of-service',
		'wp-login.php',
	];
}

function vt_maint_hololist_url_is_reserved( $url ) {
	$u = vt_maint_clean_url( (string) $url );
	if ( '' === $u ) {
		return false;
	}
	$path = trim( (string) wp_parse_url( $u, PHP_URL_PATH ), '/' );
	if ( '' === $path ) {
		return false;
	}
	$parts = explode( '/', $path );
	$seg   = vt_maint_lower( trim( (string) ( $parts[0] ?? '' ) ) );
	if ( '' === $seg ) {
		return false;
	}
	return in_array( $seg, vt_maint_hololist_reserved_paths(), true );
}

function vt_maint_cleanup_hololist_noise_run( $batch = 120 ) {
	$lock_key = 'vt_maint_cleanup_hololist_noise_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 1800 ) ) {
		return [ 'locked' => 1 ];
	}

	try {
		$batch = max( 20, min( 500, intval( $batch ) ) );
		$checked = 0;
		$deleted = 0;
		$kept = 0;
		$items = [];

		$q = new WP_Query(
			[
				'post_type'      => 'vtuber',
				'post_status'    => 'publish',
				'posts_per_page' => $batch * 3,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'meta_query'     => [
					[
						'key'   => 'vt_data_origin',
						'value' => 'hololist',
					],
				],
			]
		);

		if ( $q->have_posts() ) {
			foreach ( (array) $q->posts as $pid ) {
				$pid = intval( $pid );
				if ( $pid <= 0 ) {
					continue;
				}
				$checked++;
				if ( $checked > $batch ) {
					break;
				}

				$hl_url = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_hololist_url', true ) );
				$title  = trim( (string) get_the_title( $pid ) );
				$title_norm = vt_maint_lower( preg_replace( '/\s+/u', ' ', $title ) );
				$has_social = vt_maint_post_has_any_social_url( $pid );
				$reserved = vt_maint_hololist_url_is_reserved( $hl_url );
				$generic_title = in_array( $title_norm, [ 'event', 'events', 'news', 'announcement' ], true );

				if ( $reserved || ( $generic_title && ! $has_social ) ) {
					wp_delete_post( $pid, true );
					$deleted++;
					if ( count( $items ) < 80 ) {
						$items[] = [
							'id'    => $pid,
							'title' => $title,
							'url'   => $hl_url,
							'reason'=> $reserved ? 'reserved_path' : 'generic_title_without_social',
						];
					}
					continue;
				}
				$kept++;
			}
			wp_reset_postdata();
		}

		$report = [
			'ok'      => 1,
			'utc'     => gmdate( 'c' ),
			'batch'   => $batch,
			'checked' => $checked,
			'deleted' => $deleted,
			'kept'    => $kept,
			'items'   => $items,
		];
		vt_maint_write_log_json( 'hololist-noise-cleanup-last.json', $report );
		vt_maint_log( 'hololist_noise_cleanup checked=' . intval( $checked ) . ' deleted=' . intval( $deleted ) . ' kept=' . intval( $kept ) );
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_cleanup_no_avatar_no_social_run( $batch = 120 ) {
	$lock_key = 'vt_maint_cleanup_no_avatar_no_social_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 1800 ) ) {
		return [ 'locked' => 1 ];
	}
	try {
		global $wpdb;
		$batch = max( 20, min( 500, intval( $batch ) ) );
		$checked = 0;
		$deleted = 0;
		$kept = 0;
		$items = [];
		$cursor_key = 'vt_cleanup_no_avatar_cursor_id';
		$cursor_before = max( 0, intval( get_option( $cursor_key, 0 ) ) );
		$cursor_after = $cursor_before;
		$scan_cap = max( $batch * 3, 300 );

		$fetch_ids = static function( $from_id, $limit ) use ( $wpdb ) {
			$posts = $wpdb->posts;
			$sql = $wpdb->prepare(
				"SELECT ID FROM {$posts}
				 WHERE post_type='vtuber' AND post_status='publish' AND ID > %d
				 ORDER BY ID ASC
				 LIMIT %d",
				intval( $from_id ),
				intval( $limit )
			);
			$ids = $wpdb->get_col( $sql );
			return array_values( array_filter( array_map( 'intval', (array) $ids ) ) );
		};

		$ids = $fetch_ids( $cursor_before, $scan_cap );
		if ( empty( $ids ) && $cursor_before > 0 ) {
			$cursor_before = 0;
			$ids = $fetch_ids( 0, $scan_cap );
		}

		if ( ! empty( $ids ) ) {
			foreach ( $ids as $pid ) {
				$pid = intval( $pid );
				if ( $pid <= 0 ) {
					continue;
				}
				$checked++;
				$cursor_after = max( $cursor_after, $pid );
				if ( $checked > ( $batch * 3 ) ) {
					break;
				}

				$has_social = vt_maint_post_has_any_social_url( $pid );
				$thumb = vt_maint_clean_url( (string) get_the_post_thumbnail_url( $pid, 'full' ) );
				if ( '' === $thumb ) {
					$thumb = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_thumb_url', true ) );
				}
				if ( '' === $thumb ) {
					$thumb = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_thumb_source_url', true ) );
				}
				$has_thumb = '' !== $thumb && ! vt_maint_is_placeholder_avatar_url( $thumb );

				$summary = trim( (string) get_post_meta( $pid, 'vt_summary', true ) );
				$summary_len = function_exists( 'mb_strlen' ) ? intval( mb_strlen( $summary, 'UTF-8' ) ) : strlen( $summary );
				$title = trim( (string) get_the_title( $pid ) );

				// Strict deletion criteria:
				// 1) no social + no usable thumb + almost no content.
				// 2) or already marked as "no social source" and still no social+thumb
				//    (prevents permanently broken placeholder entries from lingering).
				$marked_no_social = '1' === (string) get_post_meta( $pid, 'vt_no_social_source', true );
				$delete_it = ( ! $has_social ) && ( ! $has_thumb ) && ( $summary_len < 20 || $marked_no_social );
				if ( $delete_it ) {
					wp_delete_post( $pid, true );
					$deleted++;
					if ( count( $items ) < 80 ) {
						$items[] = [
							'id'      => $pid,
							'title'   => $title,
							'summary' => $summary,
						];
					}
				} else {
					$kept++;
				}

				if ( $deleted >= $batch ) {
					break;
				}
			}
		}

		if ( $cursor_after > 0 ) {
			update_option( $cursor_key, intval( $cursor_after ), false );
		} else {
			update_option( $cursor_key, 0, false );
		}

		$report = [
			'ok'      => 1,
			'utc'     => gmdate( 'c' ),
			'batch'   => $batch,
			'checked' => $checked,
			'deleted' => $deleted,
			'kept'    => $kept,
			'cursor_before' => intval( $cursor_before ),
			'cursor_after'  => intval( $cursor_after ),
			'items'   => $items,
		];
		vt_maint_write_log_json( 'no-avatar-no-social-cleanup-last.json', $report );
		vt_maint_log( 'no_avatar_no_social_cleanup checked=' . intval( $checked ) . ' deleted=' . intval( $deleted ) . ' kept=' . intval( $kept ) );
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_extract_social_links_from_html( $html ) {
	$html = (string) $html;
	$out = [
		'vt_youtube_url'  => '',
		'vt_twitch_url'   => '',
		'vt_twitter_url'  => '',
		'vt_facebook_url' => '',
		'vt_instagram'    => '',
		'vt_bluesky_url'  => '',
		'vt_official_url' => '',
	];
	if ( '' === trim( $html ) ) {
		return $out;
	}

	$urls = [];
	if ( preg_match_all( '#https?://[^\s"\'<>\)]+#i', $html, $m ) ) {
		$urls = array_values( array_unique( array_map( 'vt_maint_clean_url', (array) $m[0] ) ) );
	}
	foreach ( $urls as $u ) {
		if ( '' === $u ) {
			continue;
		}
		$lu = strtolower( $u );
		if ( '' === $out['vt_youtube_url'] && ( false !== strpos( $lu, 'youtube.com/' ) || false !== strpos( $lu, 'youtu.be/' ) ) ) {
			$out['vt_youtube_url'] = $u;
			continue;
		}
		if ( '' === $out['vt_twitch_url'] && false !== strpos( $lu, 'twitch.tv/' ) ) {
			$out['vt_twitch_url'] = $u;
			continue;
		}
		if ( '' === $out['vt_twitter_url'] && ( false !== strpos( $lu, 'twitter.com/' ) || false !== strpos( $lu, 'x.com/' ) ) ) {
			$out['vt_twitter_url'] = $u;
			continue;
		}
		if ( '' === $out['vt_facebook_url'] && false !== strpos( $lu, 'facebook.com/' ) ) {
			$out['vt_facebook_url'] = $u;
			continue;
		}
		if ( '' === $out['vt_instagram'] && false !== strpos( $lu, 'instagram.com/' ) ) {
			$out['vt_instagram'] = $u;
			continue;
		}
		if ( '' === $out['vt_bluesky_url'] && ( false !== strpos( $lu, 'bsky.app/' ) || false !== strpos( $lu, 'bsky.social' ) ) ) {
			$out['vt_bluesky_url'] = $u;
			continue;
		}
		if ( '' === $out['vt_official_url'] && false === strpos( $lu, 'hololist.net/' ) ) {
			$out['vt_official_url'] = $u;
		}
	}
	return $out;
}

function vt_maint_apply_social_links_if_empty( $post_id, $links ) {
	$post_id = intval( $post_id );
	$links   = is_array( $links ) ? $links : [];
	$updated = 0;
	foreach ( [
		'vt_youtube_url',
		'vt_twitch_url',
		'vt_twitter_url',
		'vt_facebook_url',
		'vt_instagram',
		'vt_bluesky_url',
		'vt_official_url',
	] as $mk ) {
		$cur = vt_maint_clean_url( (string) get_post_meta( $post_id, $mk, true ) );
		$val = vt_maint_clean_url( (string) ( $links[ $mk ] ?? '' ) );
		if ( '' === $cur && '' !== $val ) {
			update_post_meta( $post_id, $mk, $val );
			$updated++;
		}
	}
	return $updated;
}

function vt_maint_mark_no_social_source( $post_id, $mark = true ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return;
	}
	if ( $mark ) {
		update_post_meta( $post_id, 'vt_no_social_source', '1' );
		update_post_meta( $post_id, 'vt_no_social_marked_utc', gmdate( 'c' ) );
		if ( taxonomy_exists( 'role-tag' ) ) {
			$tid = vt_maint_ensure_term( 'role-tag', 'Source Needed', 'source-needed' );
			if ( $tid ) {
				wp_set_object_terms( $post_id, [ intval( $tid ) ], 'role-tag', true );
			}
		}
	} else {
		delete_post_meta( $post_id, 'vt_no_social_source' );
		delete_post_meta( $post_id, 'vt_no_social_marked_utc' );
		if ( taxonomy_exists( 'role-tag' ) ) {
			$term = get_term_by( 'slug', 'source-needed', 'role-tag' );
			if ( $term && ! is_wp_error( $term ) ) {
				wp_remove_object_terms( $post_id, [ intval( $term->term_id ) ], 'role-tag' );
			}
		}
	}
}

function vt_maint_fix_no_social_entries_run( $batch = 120 ) {
	$lock_key = 'vt_maint_fix_no_social_entries_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 900, 1800 ) ) {
		return [ 'locked' => 1 ];
	}
	try {
		$batch = max( 20, min( 400, intval( $batch ) ) );
		$checked = 0;
		$filled = 0;
		$marked = 0;
		$already_marked = 0;
		$items = [];

		$q = new WP_Query(
			[
				'post_type'      => 'vtuber',
				'post_status'    => 'publish',
				'posts_per_page' => -1,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'fields'         => 'ids',
				'no_found_rows'  => true,
			]
		);

		if ( $q->have_posts() ) {
			foreach ( (array) $q->posts as $pid ) {
				$pid = intval( $pid );
				if ( $pid <= 0 ) {
					continue;
				}
				if ( vt_maint_post_has_any_social_url( $pid ) ) {
					vt_maint_mark_no_social_source( $pid, false );
					continue;
				}

				$checked++;
				$delta = 0;

				// Try 1: recover links from hololist profile URL (if present).
				$hl = vt_maint_clean_url( (string) get_post_meta( $pid, 'vt_hololist_url', true ) );
				if ( '' !== $hl && function_exists( 'vt_maint_hololist_fetch_html_result' ) && function_exists( 'vt_maint_hololist_parse_profile' ) ) {
					$res = vt_maint_hololist_fetch_html_result( $hl, 2 );
					if ( ! empty( $res['ok'] ) && ! empty( $res['body'] ) ) {
						$p = vt_maint_hololist_parse_profile( (string) $res['body'], $hl, '' );
						$delta += vt_maint_apply_social_links_if_empty(
							$pid,
							[
								'vt_youtube_url'  => (string) ( $p['youtube'] ?? '' ),
								'vt_twitch_url'   => (string) ( $p['twitch'] ?? '' ),
								'vt_twitter_url'  => (string) ( $p['twitter'] ?? '' ),
								'vt_facebook_url' => (string) ( $p['facebook'] ?? '' ),
								'vt_bluesky_url'  => (string) ( $p['bluesky'] ?? '' ),
								'vt_official_url' => (string) ( $p['official'] ?? '' ),
							]
						);
					}
				}

				// Try 2: recover links from source/official page HTML.
				if ( ! vt_maint_post_has_any_social_url( $pid ) ) {
					foreach ( [ 'vt_source_url', 'vt_official_url' ] as $mk ) {
						$u = vt_maint_clean_url( (string) get_post_meta( $pid, $mk, true ) );
						if ( '' === $u ) {
							continue;
						}
						$r = wp_remote_get( $u, [ 'timeout' => 12, 'headers' => [ 'User-Agent' => 'USADA-VT-Maint/1.0' ] ] );
						if ( is_wp_error( $r ) ) {
							continue;
						}
						$html = (string) wp_remote_retrieve_body( $r );
						if ( '' === trim( $html ) ) {
							continue;
						}
						$delta += vt_maint_apply_social_links_if_empty( $pid, vt_maint_extract_social_links_from_html( $html ) );
						if ( vt_maint_post_has_any_social_url( $pid ) ) {
							break;
						}
					}
				}

				$has_social_now = vt_maint_post_has_any_social_url( $pid );
				if ( $has_social_now ) {
					$filled++;
					vt_maint_mark_no_social_source( $pid, false );
				} else {
					$was_marked = '1' === (string) get_post_meta( $pid, 'vt_no_social_source', true );
					vt_maint_mark_no_social_source( $pid, true );
					if ( $was_marked ) {
						$already_marked++;
					} else {
						$marked++;
					}
				}

				if ( count( $items ) < 120 ) {
					$items[] = [
						'id'      => $pid,
						'title'   => get_the_title( $pid ),
						'delta'   => $delta,
						'has_social_after' => $has_social_now ? 1 : 0,
						'marked'  => $has_social_now ? 0 : 1,
					];
				}

				if ( $checked >= $batch ) {
					break;
				}
			}
			wp_reset_postdata();
		}

		$report = [
			'ok'            => 1,
			'utc'           => gmdate( 'c' ),
			'batch'         => $batch,
			'checked'       => $checked,
			'filled'        => $filled,
			'marked'        => $marked,
			'already_marked'=> $already_marked,
			'items'         => $items,
		];
		vt_maint_write_log_json( 'no-social-fix-last.json', $report );
		vt_maint_log( 'no_social_fix checked=' . intval( $checked ) . ' filled=' . intval( $filled ) . ' marked=' . intval( $marked ) . ' already_marked=' . intval( $already_marked ) );
		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}

function vt_maint_hololist_robots_allows() {
	$cached = get_transient( 'vt_hololist_robots_cache' );
	if ( is_array( $cached ) && array_key_exists( 'allow', $cached ) ) {
		$cached['cached'] = 1;
		return $cached;
	}

	$u = 'https://hololist.net/robots.txt';
	$r = wp_remote_get( $u, [ 'timeout' => 15, 'headers' => [ 'User-Agent' => 'USADA-VT-Maint/1.0' ] ] );
	if ( is_wp_error( $r ) ) {
		// If robots cannot be fetched, default to safe "do nothing" (avoid accidental aggressive scraping).
		$res = [ 'ok' => 0, 'allow' => 0, 'reason' => 'robots_fetch_failed' ];
		set_transient( 'vt_hololist_robots_cache', $res, 6 * HOUR_IN_SECONDS );
		return $res;
	}
	$body = (string) wp_remote_retrieve_body( $r );
	if ( '' === trim( $body ) ) {
		$res = [ 'ok' => 1, 'allow' => 1, 'reason' => 'robots_empty' ];
		set_transient( 'vt_hololist_robots_cache', $res, 12 * HOUR_IN_SECONDS );
		return $res;
	}
	// Simple parser for User-agent: * block.
	$lines = preg_split( '/\r?\n/', $body );
	$in_any = false;
	$disallow_all = false;
	foreach ( $lines as $ln ) {
		$ln = trim( $ln );
		if ( '' === $ln || 0 === strpos( $ln, '#' ) ) {
			continue;
		}
		if ( preg_match( '/^User-agent\\s*:\\s*\\*\\s*$/i', $ln ) ) {
			$in_any = true;
			continue;
		}
		if ( preg_match( '/^User-agent\\s*:/i', $ln ) ) {
			$in_any = false;
			continue;
		}
		if ( $in_any && preg_match( '/^Disallow\\s*:\\s*(.*)$/i', $ln, $m ) ) {
			$path = trim( (string) $m[1] );
			if ( '/' === $path ) {
				$disallow_all = true;
				break;
			}
		}
	}
	if ( $disallow_all ) {
		$res = [ 'ok' => 1, 'allow' => 0, 'reason' => 'robots_disallow_all' ];
		set_transient( 'vt_hololist_robots_cache', $res, 12 * HOUR_IN_SECONDS );
		return $res;
	}

	$res = [ 'ok' => 1, 'allow' => 1, 'reason' => 'robots_ok' ];
	set_transient( 'vt_hololist_robots_cache', $res, 12 * HOUR_IN_SECONDS );
	return $res;
}

function vt_maint_hololist_polite_delay( $min_ms = 120, $max_ms = 320 ) {
	$min_ms = max( 50, intval( $min_ms ) );
	$max_ms = max( $min_ms, intval( $max_ms ) );
	try {
		$ms = random_int( $min_ms, $max_ms );
	} catch ( Throwable $e ) {
		$ms = $min_ms;
	}
	usleep( intval( $ms ) * 1000 );
}

function vt_maint_hololist_fetch_html_result( $url, $max_attempts = 3 ) {
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return [ 'ok' => 0, 'code' => 0, 'err' => 'empty_url', 'body' => '' ];
	}

	$max_attempts = max( 1, min( 5, intval( $max_attempts ) ) );
	$last_code    = 0;
	$last_err     = '';

	for ( $i = 1; $i <= $max_attempts; $i++ ) {
		$r = wp_remote_get(
			$url,
			[
				'timeout'     => 20,
				'redirection' => 3,
				'headers'     => [
					'User-Agent'      => 'USADA-VT-Maint/1.0',
					'Accept'          => 'text/html,application/xhtml+xml',
					'Accept-Language' => 'en-US,en;q=0.9',
				],
			]
		);

		if ( is_wp_error( $r ) ) {
			$last_code = 0;
			$last_err  = 'wp_error:' . $r->get_error_message();
		} else {
			$last_code = intval( wp_remote_retrieve_response_code( $r ) );
			$body      = (string) wp_remote_retrieve_body( $r );
			if ( $last_code >= 200 && $last_code < 300 && '' !== trim( $body ) ) {
				return [ 'ok' => 1, 'code' => $last_code, 'err' => '', 'body' => $body ];
			}
			$last_err = 'http_' . $last_code;
		}

		$retryable = ( 0 === $last_code ) || 408 === $last_code || 429 === $last_code || ( $last_code >= 500 && $last_code < 600 );
		if ( $i < $max_attempts && $retryable ) {
			// Backoff with jitter.
			$base_ms = 420 * ( 2 ** ( $i - 1 ) );
			$jit_ms  = 0;
			try {
				$jit_ms = random_int( 0, 260 );
			} catch ( Throwable $e ) {
				$jit_ms = 0;
			}
			usleep( intval( $base_ms + $jit_ms ) * 1000 );
			continue;
		}
		break;
	}

	return [ 'ok' => 0, 'code' => intval( $last_code ), 'err' => (string) $last_err, 'body' => '' ];
}

function vt_maint_hololist_fetch_html( $url ) {
	$res = vt_maint_hololist_fetch_html_result( $url, 2 );
	return (string) ( $res['body'] ?? '' );
}

function vt_maint_hololist_parse_country_list( $html ) {
	$out = [];
	if ( '' === trim( (string) $html ) ) {
		return $out;
	}
	if ( preg_match_all( '#https://hololist\\.net/category/([a-z]{2})/#i', $html, $m ) ) {
		$slugs = array_values( array_unique( array_map( 'strtolower', (array) $m[1] ) ) );
		sort( $slugs );
		foreach ( $slugs as $slug ) {
			$slug = sanitize_title( $slug );
			if ( '' === $slug ) {
				continue;
			}
			$out[] = [
				'slug' => $slug,
				'url'  => 'https://hololist.net/category/' . $slug . '/',
			];
		}
	}
	return $out;
}

function vt_maint_hololist_extract_profile_urls_from_category_page( $html ) {
	$urls = [];
	if ( '' === trim( (string) $html ) ) {
		return $urls;
	}
	if ( preg_match_all( '#href\\s*=\\s*\"(https://hololist\\.net/[^\"\\s<>]+)\"#i', $html, $m ) ) {
		foreach ( (array) $m[1] as $u ) {
			$u = vt_maint_clean_url( $u );
			if ( '' === $u ) {
				continue;
			}
			$p = (string) wp_parse_url( $u, PHP_URL_PATH );
			$p = '/' . ltrim( $p, '/' );
			// VTuber profile pages are usually a single-segment path like /some-slug/
			if ( ! preg_match( '#^/([^/]+)/?$#', $p, $mm ) ) {
				continue;
			}
			$seg = strtolower( (string) $mm[1] );
			if ( in_array( $seg, vt_maint_hololist_reserved_paths(), true ) ) {
				continue;
			}
			$urls[ $u ] = true;
		}
	}
	return array_values( array_keys( $urls ) );
}

function vt_maint_hololist_next_category_page_num( $html, $country_slug, $cur_page ) {
	$html         = (string) $html;
	$country_slug = strtolower( trim( (string) $country_slug ) );
	$cur_page     = max( 1, intval( $cur_page ) );

	// Prefer explicit rel="next" URL.
	if ( preg_match( '#<link[^>]+rel=[\"\\\']next[\"\\\'][^>]+href=[\"\\\']([^\"\\\']+)[\"\\\']#i', $html, $m ) ) {
		$u = vt_maint_clean_url( (string) $m[1] );
		$p = (string) wp_parse_url( $u, PHP_URL_PATH );
		if ( preg_match( '#/category/' . preg_quote( $country_slug, '#' ) . '/page/([0-9]+)/#i', $p, $mm ) ) {
			$n = intval( $mm[1] );
			return ( $n > $cur_page ) ? $n : 0;
		}
	}

	// Common WordPress pagination markup on category pages.
	if ( preg_match( '#<a[^>]+class=[\"\\\'][^\"\\\']*next[^\"\\\']*page-numbers[^\"\\\']*[\"\\\'][^>]+href=[\"\\\']([^\"\\\']+)[\"\\\']#i', $html, $m ) ) {
		$u = vt_maint_clean_url( (string) $m[1] );
		$p = (string) wp_parse_url( $u, PHP_URL_PATH );
		if ( preg_match( '#/category/' . preg_quote( $country_slug, '#' ) . '/page/([0-9]+)/#i', $p, $mm ) ) {
			$n = intval( $mm[1] );
			return ( $n > $cur_page ) ? $n : 0;
		}
	}

	// Fallback: if the HTML contains an obvious next page URL.
	$want = $cur_page + 1;
	if ( preg_match( '#/category/' . preg_quote( $country_slug, '#' ) . '/page/' . intval( $want ) . '/#i', $html ) ) {
		return $want;
	}
	return 0;
}

function vt_maint_hololist_extract_section_inner_html( $html, $id ) {
	$id = preg_quote( (string) $id, '#' );
	if ( preg_match( '#<section[^>]*\\sid=\"' . $id . '\"[^>]*>(.*?)</section>#is', (string) $html, $m ) ) {
		return (string) $m[1];
	}
	return '';
}

function vt_maint_hololist_strip_text( $html ) {
	$s = wp_strip_all_tags( (string) $html );
	$s = html_entity_decode( $s, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
	$s = preg_replace( '/\\s+/', ' ', (string) $s );
	return trim( (string) $s );
}

function vt_maint_hololist_extract_first_image_url( $html ) {
	// Prefer explicit "Profile picture of ..." image.
	if ( preg_match( '#<img[^>]+src=\"([^\"]+)\"[^>]+alt=\"Profile picture of [^\"]+\"#i', (string) $html, $m ) ) {
		return vt_maint_clean_url( (string) $m[1] );
	}
	// Fallback: first uploaded image.
	if ( preg_match( '#<img[^>]+src=\"(https://hololist\\.net/wp-content/uploads/[^\"]+)\"#i', (string) $html, $m ) ) {
		return vt_maint_clean_url( (string) $m[1] );
	}
	return '';
}

function vt_maint_hololist_extract_links_in_section( $section_html ) {
	$links = [];
	if ( preg_match_all( '#href\\s*=\\s*\"([^\"]+)\"#i', (string) $section_html, $m ) ) {
		foreach ( (array) $m[1] as $u ) {
			$u = vt_maint_clean_url( $u );
			if ( '' === $u ) {
				continue;
			}
			$links[] = $u;
		}
	}
	return array_values( array_unique( $links ) );
}

function vt_maint_hololist_parse_sub_count( $txt ) {
	$txt = (string) $txt;
	// Prefer explicit full number in parentheses.
	if ( preg_match( '#\\(([0-9][0-9,\\s]{2,})\\)#', $txt, $m ) ) {
		return vt_maint_parse_int( $m[1] );
	}
	// Otherwise parse formats like 139K, 1.2M
	if ( preg_match( '#\\b([0-9]+(?:\\.[0-9]+)?)\\s*([KM])\\b#i', $txt, $m ) ) {
		$n = floatval( $m[1] );
		$u = strtoupper( (string) $m[2] );
		if ( 'K' === $u ) {
			return intval( round( $n * 1000 ) );
		}
		if ( 'M' === $u ) {
			return intval( round( $n * 1000000 ) );
		}
	}
	return vt_maint_parse_int( $txt );
}

function vt_maint_hololist_parse_profile( $html, $profile_url, $country_slug_hint = '' ) {
	$profile_url = vt_maint_clean_url( $profile_url );
	$title = '';
	if ( preg_match( '#<h1[^>]*>(.*?)</h1>#is', (string) $html, $m ) ) {
		$title = vt_maint_hololist_strip_text( $m[1] );
	}

	$birthday_html = vt_maint_hololist_extract_section_inner_html( $html, 'birthday' );
	$birthday_txt  = vt_maint_hololist_strip_text( $birthday_html );
	$birthday_txt  = preg_replace( '#^Birthday\\s+#i', '', $birthday_txt );
	$birthday_txt  = preg_replace( '#\\(.*$#', '', $birthday_txt ); // drop countdown
	$birthday_txt  = trim( (string) $birthday_txt );

	$debut_html = vt_maint_hololist_extract_section_inner_html( $html, 'debut' );
	$debut_txt  = vt_maint_hololist_strip_text( $debut_html );
	$debut_txt  = preg_replace( '#^Debut Date\\s+#i', '', $debut_txt );
	$debut_txt  = preg_replace( '#\\(.*$#', '', $debut_txt ); // drop countdown
	$debut_txt  = trim( (string) $debut_txt );

	$height_html = vt_maint_hololist_extract_section_inner_html( $html, 'height' );
	$height_txt  = vt_maint_hololist_strip_text( $height_html );
	$height_txt  = preg_replace( '#^Height\\s+#i', '', $height_txt );
	$height_txt  = trim( (string) $height_txt );

	$lang_html = vt_maint_hololist_extract_section_inner_html( $html, 'language' );
	$lang_txt  = vt_maint_hololist_strip_text( $lang_html );
	$lang_txt  = preg_replace( '#^Language\\s+#i', '', $lang_txt );
	$lang_txt  = trim( (string) $lang_txt );

	$gender_html = vt_maint_hololist_extract_section_inner_html( $html, 'gender' );
	$gender_txt  = vt_maint_hololist_strip_text( $gender_html );
	$gender_txt  = preg_replace( '#^Gender\\s+#i', '', $gender_txt );
	$gender_txt  = trim( (string) $gender_txt );

	$model_html = vt_maint_hololist_extract_section_inner_html( $html, 'model' );
	$model_txt  = vt_maint_hololist_strip_text( $model_html );
	$model_txt  = preg_replace( '#^Model\\s+#i', '', $model_txt );
	$model_txt  = trim( (string) $model_txt );

	$type_html = vt_maint_hololist_extract_section_inner_html( $html, 'type' );
	$type_txt  = vt_maint_hololist_strip_text( $type_html );
	$type_txt  = preg_replace( '#^Type\\s+#i', '', $type_txt );
	$type_txt  = trim( (string) $type_txt );

	$category_html = vt_maint_hololist_extract_section_inner_html( $html, 'category' );
	$category_txt  = vt_maint_hololist_strip_text( $category_html );
	$country_name  = '';
	$country_code  = '';
	if ( preg_match( '#Category\\s+(.+?)\\s*\\(([A-Z]{2})\\)#', $category_txt, $mm ) ) {
		$country_name = trim( (string) $mm[1] );
		$country_code = trim( (string) $mm[2] );
	}

	$aff_html = vt_maint_hololist_extract_section_inner_html( $html, 'affiliation' );
	$aff_txt  = vt_maint_hololist_strip_text( $aff_html );
	$aff_txt  = preg_replace( '#^Affiliation\\s+#i', '', $aff_txt );

	$status_html = vt_maint_hololist_extract_section_inner_html( $html, 'status' );
	$status_txt  = vt_maint_hololist_strip_text( $status_html );
	$status_txt  = preg_replace( '#^Status\\s+#i', '', $status_txt );

	$desc_html = vt_maint_hololist_extract_section_inner_html( $html, 'description' );
	$desc_txt  = vt_maint_hololist_strip_text( $desc_html );
	$desc_txt  = preg_replace( '#^Description\\s+#i', '', $desc_txt );

	$links_html = vt_maint_hololist_extract_section_inner_html( $html, 'links' );
	$links      = vt_maint_hololist_extract_links_in_section( $links_html );

	$youtube = '';
	$twitch  = '';
	$twitter = '';
	$facebook = '';
	$bluesky  = '';
	$official = '';
	foreach ( $links as $u ) {
		if ( '' === $youtube && ( false !== stripos( $u, 'youtube.com/' ) || false !== stripos( $u, 'youtu.be/' ) ) ) {
			$youtube = $u;
		} elseif ( '' === $twitch && false !== stripos( $u, 'twitch.tv/' ) ) {
			$twitch = $u;
		} elseif ( '' === $twitter && ( false !== stripos( $u, 'twitter.com/' ) || false !== stripos( $u, 'x.com/' ) ) ) {
			$twitter = $u;
		} elseif ( '' === $facebook && false !== stripos( $u, 'facebook.com/' ) ) {
			$facebook = $u;
		} elseif ( '' === $bluesky && ( false !== stripos( $u, 'bsky.app/' ) || false !== stripos( $u, 'bsky.social' ) ) ) {
			$bluesky = $u;
		} elseif ( '' === $official ) {
			// Store the first non-social/general link as an "official" candidate.
			if ( false === stripos( $u, 'hololist.net/' ) ) {
				$official = $u;
			}
		}
	}

	$stat_html = vt_maint_hololist_extract_section_inner_html( $html, 'channel-statistics' );
	$stat_txt  = vt_maint_hololist_strip_text( $stat_html );
	$yt_subs   = 0;
	if ( preg_match( '#YouTube\\s*:\\s*([^\\n\\r]+)#i', $stat_txt, $mstat ) ) {
		$yt_subs = vt_maint_hololist_parse_sub_count( (string) $mstat[1] );
	}

	$content_html = vt_maint_hololist_extract_section_inner_html( $html, 'content' );
	$content_links = vt_maint_hololist_extract_links_in_section( $content_html );
	$content_items = [];
	if ( preg_match_all( '#<a[^>]+href=\"[^\"]+\"[^>]*>(.*?)</a>#is', (string) $content_html, $mm ) ) {
		foreach ( (array) $mm[1] as $t ) {
			$t = vt_maint_hololist_strip_text( $t );
			if ( '' !== $t ) {
				$content_items[] = $t;
			}
		}
		$content_items = array_values( array_unique( $content_items ) );
	}

	$img = vt_maint_hololist_extract_first_image_url( $html );
	$country_slug_hint = strtolower( trim( (string) $country_slug_hint ) );

	return [
		'url'          => $profile_url,
		'title'        => $title,
		'country_name' => $country_name,
		'country_code' => $country_code,
		'country_slug' => $country_slug_hint,
		'affiliation'  => trim( (string) $aff_txt ),
		'status'       => trim( (string) $status_txt ),
		'description'  => trim( (string) $desc_txt ),
		'birthday'     => $birthday_txt,
		'debut'        => $debut_txt,
		'height'       => $height_txt,
		'language'     => $lang_txt,
		'gender'       => $gender_txt,
		'model'        => $model_txt,
		'type'         => $type_txt,
		'content_items'=> $content_items,
		'youtube'      => $youtube,
		'twitch'       => $twitch,
		'twitter'      => $twitter,
		'facebook'     => $facebook,
		'bluesky'      => $bluesky,
		'official'     => $official,
		'youtube_subs' => intval( $yt_subs ),
		'thumb'        => $img,
	];
}

function vt_maint_hololist_find_existing_post_id( $profile ) {
	$profile_url = vt_maint_clean_url( (string) ( $profile['url'] ?? '' ) );
	$youtube     = vt_maint_clean_url( (string) ( $profile['youtube'] ?? '' ) );
	$twitch      = vt_maint_clean_url( (string) ( $profile['twitch'] ?? '' ) );

	foreach ( [ [ 'vt_hololist_url', $profile_url ], [ 'vt_youtube_url', $youtube ], [ 'vt_twitch_url', $twitch ] ] as $pair ) {
		$k = (string) $pair[0];
		$v = (string) $pair[1];
		if ( '' === $v ) {
			continue;
		}
		$q = new WP_Query(
			[
				'post_type'        => 'vtuber',
				'post_status'      => 'publish',
				'posts_per_page'   => 1,
				'fields'           => 'ids',
				'no_found_rows'    => true,
				'suppress_filters' => true,
				'meta_key'         => $k,
				'meta_value'       => $v,
			]
		);
		if ( ! empty( $q->posts ) ) {
			return intval( $q->posts[0] );
		}
	}
	return 0;
}

function vt_maint_hololist_map_life_status_slug( $status_txt ) {
	$s = strtolower( trim( (string) $status_txt ) );
	if ( '' === $s ) {
		return '';
	}
	if ( false !== strpos( $s, 'active' ) ) {
		return 'active';
	}
	if ( false !== strpos( $s, 'hiatus' ) || false !== strpos( $s, 'indefinite' ) || false !== strpos( $s, 'break' ) ) {
		return 'hiatus';
	}
	if ( false !== strpos( $s, 'graduated' ) || false !== strpos( $s, 'retired' ) || false !== strpos( $s, 'inactive' ) ) {
		return 'graduated';
	}
	return '';
}

function vt_maint_hololist_upsert_post( $profile ) {
	// Do not touch Taiwan data via hololist.
	$cc = strtoupper( trim( (string) ( $profile['country_code'] ?? '' ) ) );
	$cs = strtolower( trim( (string) ( $profile['country_slug'] ?? '' ) ) );
	if ( 'TW' === $cc || 'tw' === $cs ) {
		return [ 'ok' => 1, 'skipped' => 1, 'reason' => 'skip_tw' ];
	}

	$post_id = vt_maint_hololist_find_existing_post_id( $profile );
	if ( $post_id > 0 ) {
		$origin = (string) get_post_meta( $post_id, 'vt_data_origin', true );
		if ( 'tw_sheet' === $origin ) {
			return [ 'ok' => 1, 'skipped' => 1, 'reason' => 'existing_tw_sheet' ];
		}
	}

	$title = (string) ( $profile['title'] ?? '' );
	if ( '' === trim( $title ) ) {
		return [ 'ok' => 0, 'skipped' => 1, 'reason' => 'missing_title' ];
	}

	$is_new = false;
	if ( $post_id <= 0 ) {
		$post_id = wp_insert_post(
			[
				'post_type'    => 'vtuber',
				'post_status'  => 'publish',
				'post_title'   => $title,
				'post_excerpt' => '',
			],
			true
		);
		if ( is_wp_error( $post_id ) ) {
			return [ 'ok' => 0, 'skipped' => 1, 'reason' => 'wp_insert_post:' . $post_id->get_error_message() ];
		}
		$post_id = intval( $post_id );
		$is_new  = true;
	}

	update_post_meta( $post_id, 'vt_data_origin', 'hololist' );
	update_post_meta( $post_id, 'vt_hololist_url', (string) ( $profile['url'] ?? '' ) );
	update_post_meta( $post_id, 'vt_country_code', (string) ( $profile['country_code'] ?? '' ) );
	update_post_meta( $post_id, 'vt_country_name', (string) ( $profile['country_name'] ?? '' ) );
	update_post_meta( $post_id, 'vt_display_name', $title );
	update_post_meta( $post_id, 'vt_hololist_synced_utc', gmdate( 'c' ) );

	// Taxonomy: country.
	if ( taxonomy_exists( 'country' ) ) {
		$cc_slug = strtolower( sanitize_title( (string) ( $profile['country_slug'] ?? '' ) ) );
		$cc2     = strtoupper( trim( (string) ( $profile['country_code'] ?? '' ) ) );
		if ( '' === $cc_slug && '' !== $cc2 ) {
			$cc_slug = strtolower( sanitize_title( $cc2 ) );
		}
		$cname = trim( (string) ( $profile['country_name'] ?? '' ) );
		if ( '' === $cname && '' !== $cc2 ) {
			$cname = $cc2;
		}
		if ( '' !== $cc_slug && '' !== $cname ) {
			$tid = vt_maint_ensure_term( 'country', $cname, $cc_slug );
			if ( $tid ) {
				wp_set_object_terms( $post_id, [ intval( $tid ) ], 'country', false );
			}
		}
	}

	// Basic profile fields.
	foreach ( [
		'vt_birthday' => 'birthday',
		'vt_debut_raw' => 'debut',
		'vt_height_raw' => 'height',
		'vt_primary_language' => 'language',
		'vt_gender' => 'gender',
		'vt_model' => 'model',
		'vt_type' => 'type',
	] as $mk => $pk ) {
		$val = trim( (string) ( $profile[ $pk ] ?? '' ) );
		if ( '' === $val ) {
			continue;
		}
		$cur = (string) get_post_meta( $post_id, $mk, true );
		if ( '' === trim( $cur ) ) {
			update_post_meta( $post_id, $mk, $val );
		}
	}
	if ( ! empty( $profile['content_items'] ) && is_array( $profile['content_items'] ) ) {
		$cur = get_post_meta( $post_id, 'vt_content_tags', true );
		if ( '' === trim( (string) $cur ) ) {
			update_post_meta( $post_id, 'vt_content_tags', implode( ', ', array_slice( (array) $profile['content_items'], 0, 20 ) ) );
		}
	}

	// Debut date/year (best-effort).
	$debut_raw = trim( (string) ( $profile['debut'] ?? '' ) );
	if ( '' !== $debut_raw ) {
		$acf = vt_maint_parse_date_for_acf( $debut_raw );
		if ( '' !== $acf ) {
			$cur = (string) get_post_meta( $post_id, 'vt_debut_date', true );
			if ( '' === trim( $cur ) ) {
				update_post_meta( $post_id, 'vt_debut_date', $acf );
			}
		}
	}
	if ( taxonomy_exists( 'debut-year' ) ) {
		$y = 0;
		$cur_acf = (string) get_post_meta( $post_id, 'vt_debut_date', true );
		if ( '' !== trim( $cur_acf ) ) {
			$y = vt_maint_extract_year( $cur_acf );
		}
		if ( $y <= 0 ) {
			$cur_raw = (string) get_post_meta( $post_id, 'vt_debut_raw', true );
			$y = vt_maint_extract_year( $cur_raw );
		}
		if ( $y > 0 ) {
			$tid = vt_maint_ensure_term( 'debut-year', (string) $y, (string) $y );
			if ( $tid ) {
				wp_set_object_terms( $post_id, [ intval( $tid ) ], 'debut-year', false );
			}
		}
	}

	// Links (only fill if currently empty).
	foreach ( [
		'vt_youtube_url'     => 'youtube',
		'vt_twitch_url'      => 'twitch',
		'vt_twitter_url'     => 'twitter',
		'vt_facebook_url'    => 'facebook',
		'vt_bluesky_url'     => 'bluesky',
		'vt_affiliation_url' => 'official',
	] as $mk => $pk ) {
		$cur = vt_maint_clean_url( (string) get_post_meta( $post_id, $mk, true ) );
		$val = vt_maint_clean_url( (string) ( $profile[ $pk ] ?? '' ) );
		if ( '' === $cur && '' !== $val ) {
			update_post_meta( $post_id, $mk, $val );
		}
	}
	$off = vt_maint_clean_url( (string) ( $profile['official'] ?? '' ) );
	if ( '' !== $off ) {
		$cur_off = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_official_url', true ) );
		if ( '' === $cur_off ) {
			update_post_meta( $post_id, 'vt_official_url', $off );
		}
	}

	// Agency.
	$aff = trim( (string) ( $profile['affiliation'] ?? '' ) );
	if ( '' !== $aff ) {
		update_post_meta( $post_id, 'vt_affiliation', $aff );
		if ( taxonomy_exists( 'agency' ) ) {
			// Do not treat "Independent/Indie" as an org.
			if ( ! preg_match( '/^(indie|independent|solo|個人勢|個人)$/iu', $aff ) ) {
				$tid = vt_maint_ensure_term( 'agency', $aff );
				if ( $tid ) {
					wp_set_object_terms( $post_id, [ intval( $tid ) ], 'agency', false );
				}
			} elseif ( taxonomy_exists( 'role-tag' ) ) {
				$rid = vt_maint_ensure_term( 'role-tag', '個人勢', 'indie' );
				if ( $rid ) {
					wp_set_object_terms( $post_id, [ intval( $rid ) ], 'role-tag', true );
				}
			}
		}
	}

	// Lifecycle.
	$life_slug = vt_maint_hololist_map_life_status_slug( (string) ( $profile['status'] ?? '' ) );
	if ( '' !== $life_slug && taxonomy_exists( 'life-status' ) ) {
		$labels = [
			'active'    => 'Active',
			'hiatus'    => 'Hiatus',
			'graduated' => 'Graduated',
		];
		$tid = vt_maint_ensure_term( 'life-status', (string) ( $labels[ $life_slug ] ?? $life_slug ), $life_slug );
		if ( $tid ) {
			wp_set_object_terms( $post_id, [ intval( $tid ) ], 'life-status', false );
		}
	}

	// Description -> store in vt_summary if empty (do not overwrite sheet-authored content).
	$desc = trim( (string) ( $profile['description'] ?? '' ) );
	$sum  = (string) get_post_meta( $post_id, 'vt_summary', true );
	if ( '' === trim( $sum ) && '' !== $desc ) {
		update_post_meta( $post_id, 'vt_summary', wp_trim_words( $desc, 120 ) );
	}

	// Subscriber count.
	$subs = intval( $profile['youtube_subs'] ?? 0 );
	if ( $subs > 0 && intval( get_post_meta( $post_id, 'vt_youtube_subs', true ) ) <= 0 ) {
		update_post_meta( $post_id, 'vt_youtube_subs', $subs );
	}

	// Thumbnail candidate (do not hotlink in frontend; store and let our avatar pipeline download it).
	$thumb = vt_maint_clean_url( (string) ( $profile['thumb'] ?? '' ) );
	if ( '' !== $thumb ) {
		$cur_thumb = vt_maint_clean_url( (string) get_post_meta( $post_id, 'vt_thumb_url', true ) );
		if ( '' === $cur_thumb || vt_maint_is_placeholder_avatar_url( $cur_thumb ) ) {
			update_post_meta( $post_id, 'vt_thumb_url', $thumb );
			update_post_meta( $post_id, 'vt_thumb_source_url', $thumb );
		}
	}

	// Propagate VT meta across translations so non-default language pages have the same English hololist data.
	vt_maint_propagate_vt_meta_to_translations( $post_id );

	// NOTE: Hololist sync intentionally does NOT resolve avatars via external requests.
	// Avatar resolution is handled by the existing fillthumbs pipeline to keep this sync fast and polite.
	return [ 'ok' => 1, 'id' => $post_id, 'new' => $is_new ? 1 : 0 ];
}

function vt_maint_sync_hololist_run( $max_profiles = 60 ) {
	$lock_key = 'vt_maint_sync_hololist_lock';
	if ( ! vt_maint_acquire_lock( $lock_key, 1800, 6 * HOUR_IN_SECONDS ) ) {
		return [ 'locked' => 1 ];
	}

	try {
		$state = get_option( 'vt_hololist_state', [] );
		if ( ! is_array( $state ) ) {
			$state = [];
		}
		$done = ! empty( $state['done'] );
		$done_utc = (string) ( $state['done_utc'] ?? '' );
		$done_ts = $done_utc ? strtotime( $done_utc ) : 0;
		// If already done recently, do nothing (prevents looping the last country forever).
		if ( $done && $done_ts && ( time() - $done_ts ) < 7 * DAY_IN_SECONDS ) {
			return [ 'ok' => 1, 'done' => 1, 'skipped' => 1, 'reason' => 'already_done', 'done_utc' => $done_utc ];
		}

		$max_profiles = max( 1, min( 160, intval( $max_profiles ) ) );

		$robots = vt_maint_hololist_robots_allows();
		if ( empty( $robots['allow'] ) ) {
			vt_maint_log( 'hololist_sync skipped reason=' . (string) ( $robots['reason'] ?? 'robots' ) );
			return [ 'ok' => 0, 'skipped' => 1, 'reason' => (string) ( $robots['reason'] ?? 'robots' ) ];
		}

		// Country cache.
		$countries = get_option( 'vt_hololist_countries_cache', [] );
		$cached_utc = (string) get_option( 'vt_hololist_countries_cache_utc', '' );
		$stale = true;
		if ( is_array( $countries ) && ! empty( $countries ) && '' !== $cached_utc ) {
			$ts = strtotime( $cached_utc );
			if ( $ts && ( time() - $ts ) < 7 * DAY_IN_SECONDS ) {
				$stale = false;
			}
		}
		if ( $stale ) {
			$cat_res = vt_maint_hololist_fetch_html_result( 'https://hololist.net/category/', 3 );
			if ( empty( $cat_res['ok'] ) ) {
				vt_maint_log( 'hololist_sync country_list_fetch_failed code=' . intval( $cat_res['code'] ?? 0 ) . ' err=' . (string) ( $cat_res['err'] ?? '' ) );
				return [
					'ok'    => 0,
					'error' => 'country_list_fetch_failed',
					'code'  => intval( $cat_res['code'] ?? 0 ),
					'err'   => (string) ( $cat_res['err'] ?? '' ),
				];
			}
			$countries = vt_maint_hololist_parse_country_list( (string) ( $cat_res['body'] ?? '' ) );
			update_option( 'vt_hololist_countries_cache', $countries );
			update_option( 'vt_hololist_countries_cache_utc', gmdate( 'c' ) );
		}

		// Exclude Taiwan.
		$countries = array_values( array_filter( (array) $countries, function ( $c ) {
			$slug = is_array( $c ) ? (string) ( $c['slug'] ?? '' ) : '';
			return 'tw' !== strtolower( trim( $slug ) );
		} ) );

		if ( empty( $countries ) ) {
			return [ 'ok' => 0, 'error' => 'no_countries' ];
		}

		$cur_slug = strtolower( trim( (string) ( $state['country_slug'] ?? '' ) ) );
		$cur_page = intval( $state['page'] ?? 1 );
		if ( $cur_page <= 0 ) {
			$cur_page = 1;
		}

		// Find cursor index.
		$idx = 0;
		if ( '' !== $cur_slug ) {
			foreach ( $countries as $i => $c ) {
				if ( strtolower( (string) ( $c['slug'] ?? '' ) ) === $cur_slug ) {
					$idx = intval( $i );
					break;
				}
			}
		}
		$cur = $countries[ $idx ] ?? $countries[0];
		$cur_slug = (string) ( $cur['slug'] ?? '' );

		$processed = 0;
		$created   = 0;
		$updated   = 0;
		$skipped   = 0;
		$errors    = [];
		$done_all  = false;

		while ( $processed < $max_profiles && $idx < count( $countries ) ) {
			$list_url = (string) ( $cur['url'] ?? '' );
			if ( $cur_page > 1 ) {
				$list_url = trailingslashit( $list_url ) . 'page/' . intval( $cur_page ) . '/';
			}

			$list_res = vt_maint_hololist_fetch_html_result( $list_url, 3 );
			$html     = (string) ( $list_res['body'] ?? '' );
			if ( empty( $list_res['ok'] ) ) {
				$errors[] = [
					'where' => 'list',
					'url'   => $list_url,
					'code'  => intval( $list_res['code'] ?? 0 ),
					'err'   => (string) ( $list_res['err'] ?? 'fetch_failed' ),
				];
				$code = intval( $list_res['code'] ?? 0 );
				if ( 403 === $code || 429 === $code ) {
					// Back off and stop early to avoid hammering when blocked/rate-limited.
					vt_maint_hololist_polite_delay( 1200, 2200 );
					break;
				}
				// Move on to next country to avoid being stuck.
				$idx++;
				$cur_page = 1;
				$cur = $countries[ $idx ] ?? null;
				if ( ! $cur ) {
					break;
				}
				$cur_slug = (string) ( $cur['slug'] ?? '' );
				continue;
			}

			$profiles = vt_maint_hololist_extract_profile_urls_from_category_page( $html );
			if ( empty( $profiles ) ) {
				// No profiles on this page; move to next country.
				$idx++;
				$cur_page = 1;
				$cur = $countries[ $idx ] ?? null;
				if ( ! $cur ) {
					break;
				}
				$cur_slug = (string) ( $cur['slug'] ?? '' );
				continue;
			}

			foreach ( $profiles as $purl ) {
				if ( $processed >= $max_profiles ) {
					break;
				}
				$prof_res = vt_maint_hololist_fetch_html_result( $purl, 3 );
				$phtml    = (string) ( $prof_res['body'] ?? '' );
				if ( empty( $prof_res['ok'] ) ) {
					$errors[] = [
						'where' => 'profile',
						'url'   => $purl,
						'code'  => intval( $prof_res['code'] ?? 0 ),
						'err'   => (string) ( $prof_res['err'] ?? 'fetch_failed' ),
					];
					$code = intval( $prof_res['code'] ?? 0 );
					if ( 403 === $code || 429 === $code ) {
						vt_maint_hololist_polite_delay( 1200, 2200 );
						break 2;
					}
					continue;
				}
				$profile = vt_maint_hololist_parse_profile( $phtml, $purl, $cur_slug );
				$res = vt_maint_hololist_upsert_post( $profile );
				if ( ! empty( $res['skipped'] ) ) {
					$skipped++;
				} elseif ( empty( $res['ok'] ) ) {
					$errors[] = [ 'where' => 'upsert', 'url' => $purl, 'err' => (string) ( $res['reason'] ?? 'unknown' ) ];
				} else {
					if ( ! empty( $res['new'] ) ) {
						$created++;
					} else {
						$updated++;
					}
				}
				$processed++;
				vt_maint_hololist_polite_delay();
			}

			// Page navigation: if there is a next page link, advance; otherwise move to next country.
			$next_page = vt_maint_hololist_next_category_page_num( $html, $cur_slug, $cur_page );
			if ( $next_page > $cur_page ) {
				$cur_page = $next_page;
			} else {
				$idx++;
				$cur_page = 1;
				$cur = $countries[ $idx ] ?? null;
				if ( ! $cur ) {
					$done_all = true;
					break;
				}
				$cur_slug = (string) ( $cur['slug'] ?? '' );
			}
		}

		$new_state = [
			'utc'          => gmdate( 'c' ),
			'country_slug' => (string) $cur_slug,
			'page'         => intval( $cur_page ),
			'country_idx'  => intval( $idx ),
		];
		if ( $done_all || $idx >= count( $countries ) ) {
			$new_state['done'] = 1;
			$new_state['done_utc'] = gmdate( 'c' );
			// Clear cursor so we don't match the last country on the next run.
			$new_state['country_slug'] = '';
			$new_state['page'] = 1;
		} else {
			$new_state['done'] = 0;
		}
		update_option( 'vt_hololist_state', $new_state );

		$report = [
			'utc'       => gmdate( 'c' ),
			'ok'        => true,
			'done'      => ! empty( $new_state['done'] ) ? 1 : 0,
			'processed' => $processed,
			'created'   => $created,
			'updated'   => $updated,
			'skipped'   => $skipped,
			'state'     => $new_state,
			'errors'    => array_slice( $errors, 0, 40 ),
		];
		$dir = WP_CONTENT_DIR . '/uploads/vt-logs/';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
		}
		@file_put_contents( $dir . 'hololist-sync-last.json', json_encode( $report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) );

		vt_maint_log( 'hololist_sync processed=' . $processed . ' created=' . $created . ' updated=' . $updated . ' skipped=' . $skipped . ' errors=' . count( $errors ) );

		return $report;
	} finally {
		vt_maint_release_lock( $lock_key );
	}
}
