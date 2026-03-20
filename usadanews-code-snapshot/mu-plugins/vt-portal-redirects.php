<?php
/**
 * MU Plugin: Redirect legacy / low-value pages to the portal home.
 *
 * Goal:
 * - Reduce indexed "old site" surfaces (category/tag/author/date archives etc.)
 * - Keep portal endpoints intact (vtuber database + taxonomies + language prefixes).
 *
 * This is intentionally conservative: it redirects common archive patterns that are
 * typically low-value for this project and that often remain indexed from old themes.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Keep homepage URL deterministic:
// when users type https://usadanews.com directly, do not auto-redirect by browser language.
// Language switching remains available via explicit UI/path selection.
add_filter( 'pll_redirect_home', '__return_false', 99 );

function vt_portal_redirects_lang_prefixes() {
	// Prefer Polylang runtime list.
	if ( function_exists( 'pll_languages_list' ) ) {
		$slugs = pll_languages_list( [ 'fields' => 'slug' ] );
		if ( is_array( $slugs ) && ! empty( $slugs ) ) {
			return array_values( array_filter( array_map( 'sanitize_title', $slugs ) ) );
		}
	}
	// Fallback.
	return [ 'cn', 'en', 'ko', 'es', 'hi', 'ja', 'ml', 'zh' ];
}

function vt_portal_detect_lang_from_path( $path ) {
	$path = is_string( $path ) ? $path : '';
	$path = '/' . ltrim( $path, '/' );
	foreach ( vt_portal_redirects_lang_prefixes() as $slug ) {
		$prefix = '/' . trim( $slug, '/' ) . '/';
		if ( strpos( $path, $prefix ) === 0 ) {
			return $slug;
		}
	}
	return '';
}

function vt_portal_strip_lang_prefix( $path, $lang_slug ) {
	$path = '/' . ltrim( (string) $path, '/' );
	$lang_slug = trim( (string) $lang_slug, '/' );
	if ( $lang_slug === '' ) {
		return $path;
	}
	$prefix = '/' . $lang_slug . '/';
	if ( strpos( $path, $prefix ) === 0 ) {
		return '/' . ltrim( substr( $path, strlen( $prefix ) ), '/' );
	}
	return $path;
}

function vt_portal_canonical_lang_slug( $lang_slug ) {
	$lang_slug = trim( (string) $lang_slug, '/' );
	// Consolidate legacy Polylang slugs to the current SEO structure.
	if ( $lang_slug === 'zh-cn' ) {
		return 'cn';
	}
	if ( $lang_slug === 'zh-tw' ) {
		return ''; // Default language has no prefix.
	}
	// Languages we are not currently supporting publicly.
	// Keep `ja` enabled because it is now part of the public language set.
	if ( in_array( $lang_slug, [ 'ms', 'ml' ], true ) ) {
		return '';
	}
	return $lang_slug;
}

function vt_portal_public_content_langs() {
	return [ 'zh', 'cn', 'ja', 'en', 'ko', 'es', 'hi' ];
}

function vt_portal_effective_content_lang_slug( $canon_lang_slug ) {
	$canon_lang_slug = trim( (string) $canon_lang_slug, '/' );
	if ( $canon_lang_slug !== '' ) {
		return $canon_lang_slug;
	}
	if ( function_exists( 'pll_default_language' ) ) {
		$default = sanitize_title( (string) pll_default_language( 'slug' ) );
		if ( $default !== '' ) {
			return $default;
		}
	}
	return 'zh';
}

function vt_portal_home_for_lang( $lang_slug ) {
	$lang_slug = trim( (string) $lang_slug, '/' );
	if ( $lang_slug !== '' && function_exists( 'pll_home_url' ) ) {
		$u = pll_home_url( $lang_slug );
		if ( is_string( $u ) && $u !== '' ) {
			return $u;
		}
	}
	return home_url( '/' );
}

function vt_portal_lang_suffix_for_tax_slugs( $canon_lang_slug ) {
	$canon_lang_slug = trim( (string) $canon_lang_slug, '/' );
	// Default language uses no prefix but uses -zh suffixed taxonomy slugs on this site.
	return $canon_lang_slug === '' ? 'zh' : $canon_lang_slug;
}

function vt_portal_try_redirect_legacy_tax_term_404( $norm, $canon_lang_slug ) {
	if ( ! function_exists( 'is_404' ) || ! is_404() ) {
		return false;
	}

	$norm = '/' . ltrim( (string) $norm, '/' );
	$canon_lang_slug = trim( (string) $canon_lang_slug, '/' );

	// Only attempt this for our portal taxonomies.
	if ( ! preg_match( '#^/(platform|agency|life-status|role|franchise|country|debut-year)/([^/]+)/?$#i', $norm, $m ) ) {
		return false;
	}
	$base = strtolower( (string) $m[1] );
	$slug = trim( (string) $m[2], '/' );
	if ( $slug === '' ) {
		return false;
	}

	$tax_by_base = [
		'platform'    => 'platform',
		'agency'      => 'agency',
		'life-status' => 'life-status',
		'role'        => 'role-tag',
		'franchise'   => 'franchise',
		'country'     => 'country',
		'debut-year'  => 'debut-year',
	];
	$tax = $tax_by_base[ $base ] ?? '';
	if ( $tax === '' ) {
		return false;
	}

	$effective_lang = vt_portal_effective_content_lang_slug( $canon_lang_slug );
	$sfx            = vt_portal_lang_suffix_for_tax_slugs( $canon_lang_slug );
	if ( $sfx === '' ) {
		$sfx = $effective_lang;
	}
	$want_suffix = '-' . $sfx;

	$base_slug = $slug;
	if ( preg_match( '#^(.*?)-(zh|cn|ja|en|ko|es|hi|ml|ms)$#i', $slug, $sm ) ) {
		$base_slug = trim( (string) $sm[1], '-' );
	}

	$candidates = [];
	foreach ( [ $slug, $base_slug . $want_suffix ] as $cand ) {
		$cand = sanitize_title( (string) $cand );
		if ( $cand !== '' ) {
			$candidates[] = $cand;
		}
	}
	if ( $effective_lang === 'zh' ) {
		$legacy_cn = sanitize_title( $base_slug . '-cn' );
		if ( $legacy_cn !== '' ) {
			$candidates[] = $legacy_cn;
		}
	}
	$candidates = array_values( array_unique( $candidates ) );

	$term = null;
	foreach ( $candidates as $candidate_slug ) {
		$term = get_term_by( 'slug', $candidate_slug, $tax );
		if ( $term && ! is_wp_error( $term ) ) {
			break;
		}
	}
	if ( ! $term || is_wp_error( $term ) ) {
		return false;
	}
	$dest = get_term_link( $term, $tax );
	if ( is_wp_error( $dest ) || ! is_string( $dest ) || $dest === '' ) {
		return false;
	}

	wp_safe_redirect( $dest, 301 );
	exit;
}

function vt_portal_vtuber_slug_bases( $slug ) {
	$slug  = sanitize_title( (string) $slug );
	$bases = [];
	if ( $slug === '' ) {
		return $bases;
	}
	$bases[] = $slug;
	$current = $slug;
	for ( $i = 0; $i < 4; $i++ ) {
		if ( ! preg_match( '#^(.*?)-\d+$#', $current, $m ) ) {
			break;
		}
		$current = sanitize_title( (string) $m[1] );
		if ( $current === '' ) {
			break;
		}
		$bases[] = $current;
	}
	return array_values( array_unique( array_filter( $bases ) ) );
}

function vt_portal_try_redirect_vtuber_404( $norm, $canon_lang_slug ) {
	if ( ! function_exists( 'is_404' ) || ! is_404() ) {
		return false;
	}

	$norm = '/' . ltrim( (string) $norm, '/' );
	if ( ! preg_match( '#^/vtuber/([^/]+)/?$#u', $norm, $m ) ) {
		return false;
	}

	global $wpdb;
	if ( ! isset( $wpdb ) ) {
		return false;
	}

	$requested_slug = sanitize_title( rawurldecode( (string) $m[1] ) );
	if ( $requested_slug === '' ) {
		return false;
	}

	$target_lang = vt_portal_effective_content_lang_slug( $canon_lang_slug );
	$candidates  = vt_portal_vtuber_slug_bases( $requested_slug );
	if ( empty( $candidates ) ) {
		return false;
	}

	$post_ids = [];
	foreach ( $candidates as $base_slug ) {
		$like = $wpdb->esc_like( $base_slug ) . '-%';
		$sql  = $wpdb->prepare(
			"SELECT ID FROM {$wpdb->posts}
			 WHERE post_type = %s
			   AND post_status = 'publish'
			   AND (post_name = %s OR post_name LIKE %s)
			 ORDER BY LENGTH(post_name) ASC, ID ASC
			 LIMIT 30",
			'vtuber',
			$base_slug,
			$like
		);
		$ids  = array_map( 'intval', (array) $wpdb->get_col( $sql ) );
		foreach ( $ids as $pid ) {
			if ( $pid > 0 && ! in_array( $pid, $post_ids, true ) ) {
				$post_ids[] = $pid;
			}
		}
		if ( count( $post_ids ) >= 30 ) {
			break;
		}
	}
	if ( empty( $post_ids ) ) {
		return false;
	}

	$best_id    = 0;
	$best_score = -999999;
	foreach ( $post_ids as $pid ) {
		$effective_pid = $pid;
		$post_slug = sanitize_title( (string) get_post_field( 'post_name', $pid ) );
		if ( $post_slug === '' ) {
			continue;
		}

		$score = 0;
		if ( $post_slug === $requested_slug ) {
			$score += 300;
		}
		foreach ( $candidates as $idx => $base_slug ) {
			if ( $post_slug === $base_slug ) {
				$score += max( 220 - ( $idx * 20 ), 120 );
				break;
			}
			if ( strpos( $post_slug, $base_slug . '-' ) === 0 ) {
				$score += max( 190 - ( $idx * 20 ), 90 );
				break;
			}
		}

		if ( function_exists( 'pll_get_post_language' ) ) {
			$post_lang = sanitize_title( (string) pll_get_post_language( $pid, 'slug' ) );
			if ( $target_lang !== '' && $post_lang !== $target_lang ) {
				if ( function_exists( 'pll_get_post' ) ) {
					$translated_id = intval( pll_get_post( $pid, $target_lang ) );
					if ( $translated_id > 0 && 'publish' === get_post_status( $translated_id ) ) {
						$effective_pid = $translated_id;
						$post_lang     = sanitize_title( (string) pll_get_post_language( $translated_id, 'slug' ) );
						$post_slug     = sanitize_title( (string) get_post_field( 'post_name', $translated_id ) );
					} else {
						continue;
					}
				} else {
					continue;
				}
			}

			if ( $post_lang === $target_lang ) {
				$score += 120;
			} elseif ( $target_lang === 'zh' && $post_lang === '' ) {
				$score += 90;
			} else {
				$score -= 60;
			}
		}

		if ( $score > $best_score ) {
			$best_score = $score;
			$best_id    = $effective_pid;
		}
	}

	if ( $best_id <= 0 ) {
		return false;
	}

	$dest = get_permalink( $best_id );
	if ( ! is_string( $dest ) || $dest === '' ) {
		return false;
	}

	$current_request_path = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_parse_url( (string) $_SERVER['REQUEST_URI'], PHP_URL_PATH ) : $norm;
	$dest_path           = (string) wp_parse_url( (string) $dest, PHP_URL_PATH );
	if ( untrailingslashit( rawurldecode( $dest_path ) ) === untrailingslashit( rawurldecode( $current_request_path ) ) ) {
		return false;
	}

	wp_safe_redirect( $dest, 301 );
	exit;
}

function vt_portal_try_redirect_vtuber_numeric_suffix_legacy( $norm, $canon_lang_slug ) {
	$norm = '/' . ltrim( (string) $norm, '/' );
	if ( ! preg_match( '#^/vtuber/([^/]+)/?$#u', $norm, $m ) ) {
		return false;
	}

	$requested_slug = sanitize_title( rawurldecode( (string) $m[1] ) );
	if ( $requested_slug === '' || ! preg_match( '#^(.+)-\d+(?:-\d+)?$#', $requested_slug, $sm ) ) {
		return false;
	}

	global $wpdb;
	if ( ! isset( $wpdb ) ) {
		return false;
	}

	$target_lang = vt_portal_effective_content_lang_slug( $canon_lang_slug );
	$candidates  = vt_portal_vtuber_slug_bases( $requested_slug );
	if ( empty( $candidates ) ) {
		return false;
	}

	$post_ids = [];
	foreach ( $candidates as $base_slug ) {
		$like = $wpdb->esc_like( $base_slug ) . '-%';
		$sql  = $wpdb->prepare(
			"SELECT ID FROM {$wpdb->posts}
			 WHERE post_type = %s
			   AND post_status = 'publish'
			   AND (post_name = %s OR post_name LIKE %s)
			 ORDER BY LENGTH(post_name) ASC, ID ASC
			 LIMIT 30",
			'vtuber',
			$base_slug,
			$like
		);
		$ids  = array_map( 'intval', (array) $wpdb->get_col( $sql ) );
		foreach ( $ids as $pid ) {
			if ( $pid > 0 && ! in_array( $pid, $post_ids, true ) ) {
				$post_ids[] = $pid;
			}
		}
	}

	$best_id    = 0;
	$best_score = -999999;
	foreach ( $post_ids as $pid ) {
		$effective_pid = $pid;
		$post_slug     = sanitize_title( (string) get_post_field( 'post_name', $pid ) );
		if ( $post_slug === '' ) {
			continue;
		}

		if ( function_exists( 'pll_get_post_language' ) ) {
			$post_lang = sanitize_title( (string) pll_get_post_language( $pid, 'slug' ) );
			if ( $target_lang !== '' && $post_lang !== $target_lang ) {
				if ( function_exists( 'pll_get_post' ) ) {
					$translated_id = intval( pll_get_post( $pid, $target_lang ) );
					if ( $translated_id > 0 && 'publish' === get_post_status( $translated_id ) ) {
						$effective_pid = $translated_id;
						$post_slug     = sanitize_title( (string) get_post_field( 'post_name', $translated_id ) );
						$post_lang     = sanitize_title( (string) pll_get_post_language( $translated_id, 'slug' ) );
					} else {
						continue;
					}
				} else {
					continue;
				}
			}
		}

		$score = 0;
		if ( $post_slug === $requested_slug ) {
			$score += 300;
		}
		foreach ( $candidates as $idx => $base_slug ) {
			if ( $post_slug === $base_slug ) {
				$score += max( 220 - ( $idx * 20 ), 120 );
				break;
			}
			if ( strpos( $post_slug, $base_slug . '-' ) === 0 ) {
				$score += max( 190 - ( $idx * 20 ), 90 );
				break;
			}
		}

		if ( $score > $best_score ) {
			$best_score = $score;
			$best_id    = $effective_pid;
		}
	}

	$dest = '';
	if ( $best_id > 0 ) {
		$best_post = get_post( $best_id );
		$best_slug = sanitize_title( (string) get_post_field( 'post_name', $best_id ) );
		$best_is_numeric = (bool) preg_match( '#-\d+(?:-\d+)?$#', $best_slug );
		if ( $best_is_numeric && $best_slug !== $requested_slug ) {
			$dest = '';
		} elseif ( function_exists( 'vtportal_get_numeric_suffix_canonical_target' ) && ( $best_post instanceof WP_Post ) ) {
			$canonical_target = (string) vtportal_get_numeric_suffix_canonical_target( $best_post );
			if ( $canonical_target !== '' ) {
				$dest = $canonical_target;
			}
		}
		if ( $dest === '' && ! $best_is_numeric ) {
			$dest = get_permalink( $best_id );
		}
		if ( $dest === '' && $best_slug === $requested_slug ) {
			$dest = get_permalink( $best_id );
		}
	}
	if ( ! is_string( $dest ) || $dest === '' ) {
		$lang_slug_for_target = vt_portal_canonical_lang_slug( $canon_lang_slug );
		$dest = $lang_slug_for_target !== ''
			? home_url( '/' . $lang_slug_for_target . '/vtuber/' )
			: home_url( '/vtuber/' );
	}

	$current_request_path = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_parse_url( (string) $_SERVER['REQUEST_URI'], PHP_URL_PATH ) : $norm;
	$dest_path           = (string) wp_parse_url( (string) $dest, PHP_URL_PATH );
	if ( untrailingslashit( rawurldecode( $dest_path ) ) === untrailingslashit( rawurldecode( $current_request_path ) ) ) {
		return false;
	}

	wp_safe_redirect( $dest, 301 );
	exit;
}

function vt_portal_is_safe_to_skip_redirects() {
	$script = isset( $_SERVER['SCRIPT_NAME'] ) ? basename( (string) $_SERVER['SCRIPT_NAME'] ) : '';
	if ( in_array( $script, [ 'vt-maint.php', 'vt-status.php' ], true ) ) {
		return true;
	}
	if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
		return true;
	}
	if ( defined( 'WP_CLI' ) && WP_CLI ) {
		return true;
	}
	if ( defined( 'DOING_CRON' ) && DOING_CRON ) {
		return true;
	}
	if ( is_admin() ) {
		return true;
	}
	return false;
}

function vt_portal_is_sitemap_request_path( $path ) {
	$path = '/' . ltrim( (string) $path, '/' );
	if ( preg_match( '#^/sitemap(_index)?\.xml$#i', $path ) ) {
		return true;
	}
	if ( false !== strpos( $path, '/wp-sitemap' ) && preg_match( '#\.xml$#i', $path ) ) {
		return true;
	}
	if ( preg_match( '#-sitemap[0-9]*\.xml$#i', $path ) ) {
		return true;
	}
	return false;
}

function vt_portal_strip_duplicate_tracking_html( $html ) {
	if ( ! is_string( $html ) || $html === '' ) {
		return $html;
	}

	// Keep the manually managed GA4 stream and remove the old HFCM-injected snippet
	// that adds a second gtag request on frontend pages.
	$html = (string) preg_replace(
		'/<!--\s*HFCM by 99 Robots - Snippet # 1: gtag\s*-->[\s\S]*?G-X1784WWBL0[\s\S]*?<!--\s*\/end HFCM by 99 Robots\s*-->\s*/i',
		'',
		$html
	);

	return $html;
}

add_action(
	'template_redirect',
	function () {
		if ( vt_portal_is_safe_to_skip_redirects() ) {
			return;
		}

		ob_start(
			static function ( $html ) {
				return vt_portal_strip_duplicate_tracking_html( $html );
			}
		);
	},
	0
);

add_action(
	'template_redirect',
	function () {
		if ( vt_portal_is_safe_to_skip_redirects() ) {
			return;
		}

		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '/';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		$path = '/' . ltrim( $path, '/' );

		// Never redirect sitemap endpoints to avoid confusing Search Console.
		// Keep all sitemap URLs self-canonical and let the owning plugin/static file respond directly.
		if ( vt_portal_is_sitemap_request_path( $path ) ) {
			return;
		}

		// Allow well-known static endpoints.
		$allow_exact = [
			'/robots.txt',
			'/ads.txt',
			'/favicon.ico',
			'/sitemap.xml',
			'/sitemap_index.xml',
		];
		if ( in_array( $path, $allow_exact, true ) ) {
			return;
		}
		if ( preg_match( '#^/sitemap(_index)?\\.xml$#i', $path ) ) {
			return;
		}
		if ( preg_match( '#\\.xml$#i', $path ) && strpos( $path, '/wp-sitemap' ) !== false ) {
			return;
		}
		if ( strpos( $path, '/wp-json/' ) === 0 ) {
			return;
		}
		if ( strpos( $path, '/wp-admin/' ) === 0 || $path === '/wp-login.php' ) {
			return;
		}

		// Figure out language from path prefix if any.
		$lang = vt_portal_detect_lang_from_path( $path );
		$canon_lang = vt_portal_canonical_lang_slug( $lang );
		if ( $lang !== '' && $canon_lang !== $lang ) {
			// Redirect legacy language prefixes to canonical ones.
			$stripped = vt_portal_strip_lang_prefix( $path, $lang );
			$dest     = $canon_lang === '' ? home_url( $stripped ) : home_url( '/' . $canon_lang . $stripped );
			wp_safe_redirect( $dest, 301 );
			exit;
		}
		$norm = vt_portal_strip_lang_prefix( $path, $lang );

		// Preemptively collapse old numeric-suffix VTuber URLs before other plugins
		// can mis-route them across languages.
		vt_portal_try_redirect_vtuber_numeric_suffix_legacy( $norm, $canon_lang );

		// Fix Polylang term-archive 404s caused by legacy/unsuffixed term slugs.
		// Example: /platform/youtube/ (404) -> /platform/youtube-zh/ (200).
		vt_portal_try_redirect_legacy_tax_term_404( $norm, $canon_lang );
		vt_portal_try_redirect_vtuber_404( $norm, $canon_lang );

		// Hard-stop legacy query URLs (?p=, ?page_id=, attachments). These often remain indexed from old WordPress states.
		// Redirect them directly to the portal home to prevent redirect_canonical from exposing old permalinks.
		if ( isset( $_GET['p'] ) || isset( $_GET['page_id'] ) || isset( $_GET['attachment_id'] ) ) {
			$target = vt_portal_home_for_lang( $lang );
			wp_safe_redirect( $target, 301 );
			exit;
		}

		// Keep important portal paths and utility pages.
		$allow_prefixes = [
			'/', // home
			'/contact/',
			'/vtuber/',
			'/voice-actor/',
			'/anime/',
			'/character/',
			'/agency/',
			'/platform/',
			'/role/',
			'/country/',
			'/debut-year/',
			'/franchise/',
			'/life-status/',
			'/agencies/',
			'/platforms/',
			'/countries/',
			'/debut-years/',
			'/roles/',
		];
		foreach ( $allow_prefixes as $pfx ) {
			if ( $pfx === '/' && $norm === '/' ) {
				// If this is actually a canonical query like ?p=123, do not treat it as a safe homepage request.
				// We want to redirect legacy singulars to the portal home.
				if ( isset( $_GET['p'] ) || isset( $_GET['page_id'] ) || isset( $_GET['attachment_id'] ) ) {
					// continue
				} else {
					return;
				}
			}
			if ( $pfx !== '/' && strpos( $norm, $pfx ) === 0 ) {
				return;
			}
		}

		// Common legacy / low-value archive patterns.
		$is_legacy = false;
		// Legacy translated landing duplicates like /en/vtuber-...-2/ should collapse to canonical home.
		if ( preg_match( '#^/vtuber-[^/]+-[0-9]+/?$#i', $norm ) ) {
			$is_legacy = true;
		}
		$legacy_prefixes = [
			'/category/',
			'/tag/',
			'/author/',
			'/archives/',
			'/archive/',
			'/page/',
		];
		foreach ( $legacy_prefixes as $pfx ) {
			if ( strpos( $norm, $pfx ) === 0 ) {
				$is_legacy = true;
				break;
			}
		}
		// Old themed paths often include /archives/ under locale/category-like prefixes.
		// Example: /cn/animation-cn/archives/123/... (legacy, frequently slow/timeout).
		if ( ! $is_legacy && false !== strpos( $norm, '/archives/' ) ) {
			$is_legacy = true;
		}
		if ( ! $is_legacy && preg_match( '#^/[0-9]{4}/[0-9]{1,2}/#', $norm ) ) {
			$is_legacy = true;
		}

		// Also redirect WordPress archive queries (more robust than path-only matching).
		if ( ! $is_legacy && ( is_category() || is_tag() || is_author() || is_date() ) ) {
			$is_legacy = true;
		}

		// Old home pagination (e.g. /page/2/) is a legacy surface for this project.
		if ( ! $is_legacy && function_exists( 'is_home' ) && is_home() && function_exists( 'is_paged' ) && is_paged() ) {
			$is_legacy = true;
		}

		// Old news/blog posts are not part of the database product. Redirect them to the new portal home
		// so "site:" results converge to the current IA.
		if ( ! $is_legacy && is_singular( 'post' ) ) {
			$is_legacy = true;
		}

		// Legacy standalone pages from old themes/plugins: redirect unless explicitly allowlisted above.
		if ( ! $is_legacy && is_page() ) {
			$page_id = function_exists( 'get_queried_object_id' ) ? intval( get_queried_object_id() ) : 0;
			$template = $page_id > 0 ? (string) get_page_template_slug( $page_id ) : '';
			$portal_templates = [
				'vt-portal-landing.php',
				'vt-platform-index.php',
				'vt-agency-index.php',
				'vt-country-index.php',
				'vt-debut-year-index.php',
				'vt-role-index.php',
				'vt-contact.php',
			];
			if ( ! in_array( $template, $portal_templates, true ) ) {
				$is_legacy = true;
			}
		}

		if ( ! $is_legacy ) {
			return;
		}

		$lang_slug_for_target = trim( (string) $lang, '/' );
		$target = $lang_slug_for_target !== ''
			? home_url( '/' . $lang_slug_for_target . '/vtuber/' )
			: home_url( '/vtuber/' );
		if ( ! is_string( $target ) || $target === '' ) {
			$target = home_url( '/' );
		}

		// Avoid self-loop.
		if ( untrailingslashit( $target ) === untrailingslashit( home_url( $path ) ) ) {
			return;
		}

		wp_safe_redirect( $target, 301 );
		exit;
	},
	0
);
