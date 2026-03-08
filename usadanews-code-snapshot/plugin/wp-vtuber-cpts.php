<?php
/**
 * Plugin Name: Vtuber Voice Actor Data Models
 * Description: Registers CPTs, taxonomies, and ACF field groups for a multilingual VTuber / Voice Actor / Anime database.
 * Version: 1.0.0
 * Author: Codex
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'VT_PORTAL_DIR', plugin_dir_path( __FILE__ ) . 'vtuber-portal/' );
define( 'VT_PORTAL_URL', plugins_url( 'vtuber-portal/', __FILE__ ) );

/**
 * Cache version for VTuber archive YouTube-sort page cache.
 * Bump this option to invalidate all page-level sort caches in O(1).
 */
function vtportal_ytsort_cache_ver() {
	$v = intval( get_option( 'vtportal_ytsort_cache_ver', 1 ) );
	return $v > 0 ? $v : 1;
}

function vtportal_bump_ytsort_cache_ver() {
	$v = vtportal_ytsort_cache_ver();
	update_option( 'vtportal_ytsort_cache_ver', $v + 1, false );
}

/**
 * Avoid cache-version thrashing during large sync batches.
 * At most one global bump per interval.
 */
function vtportal_maybe_bump_ytsort_cache_ver( $min_interval = 600 ) {
	$min_interval = max( 60, intval( $min_interval ) );
	$lock_key     = 'vtportal_ytsort_bump_lock';
	$last         = intval( get_option( 'vtportal_ytsort_cache_ver_last', 0 ) );
	$now          = time();
	if ( $last > 0 && ( $now - $last ) < $min_interval ) {
		return false;
	}
	if ( get_transient( $lock_key ) ) {
		return false;
	}
	set_transient( $lock_key, 1, 30 );
	vtportal_bump_ytsort_cache_ver();
	update_option( 'vtportal_ytsort_cache_ver_last', $now, false );
	delete_transient( $lock_key );
	return true;
}

/**
 * Build page-level cache key for expensive YouTube-sorted archive queries.
 */
function vtportal_youtube_sort_page_cache_key( $q ) {
	if ( ! ( $q instanceof WP_Query ) ) {
		return '';
	}
	$lang = sanitize_title( (string) $q->get( 'lang' ) );
	if ( '' === $lang && function_exists( 'pll_current_language' ) ) {
		$lang = sanitize_title( (string) pll_current_language( 'slug' ) );
	}
	$paged = max( 1, intval( $q->get( 'paged' ) ) );
	$ppp   = max( 1, intval( $q->get( 'posts_per_page' ) ) );
	$uri   = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$sig   = strtolower( $lang . '|' . $uri . '|p=' . $paged . '|pp=' . $ppp . '|v=' . vtportal_ytsort_cache_ver() );
	return 'vtp_yts_' . md5( $sig );
}

/**
 * Lightweight HTML page cache for anonymous visitors.
 * Targets landing / vtuber archive / vtuber taxonomy / vtuber single.
 */
function vtportal_start_html_cache() {
	if ( is_admin() || is_user_logged_in() ) {
		return;
	}
	$method = isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( (string) $_SERVER['REQUEST_METHOD'] ) : 'GET';
	if ( 'GET' !== $method ) {
		return;
	}
	if ( isset( $_GET['nocache'] ) ) {
		return;
	}
	if ( is_feed() || is_search() || is_404() || is_preview() || is_customize_preview() ) {
		return;
	}
	$is_target = is_front_page()
		|| is_post_type_archive( 'vtuber' )
		|| is_singular( 'vtuber' )
		|| is_tax( 'agency' )
		|| is_tax( 'platform' )
		|| is_tax( 'role-tag' )
		|| is_tax( 'life-status' )
		|| is_tax( 'country' )
		|| is_tax( 'debut-year' );
	if ( ! $is_target ) {
		return;
	}

	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '/';
	$u   = wp_parse_url( $uri );
	$path = isset( $u['path'] ) ? (string) $u['path'] : '/';
	$qv   = [];
	if ( ! empty( $u['query'] ) ) {
		parse_str( (string) $u['query'], $qv );
	}
	$allow_query = [ 'sort', 'paged', 'page', 'lang' ];
	$qv = array_intersect_key( (array) $qv, array_flip( $allow_query ) );
	ksort( $qv );
	$lang = function_exists( 'pll_current_language' ) ? sanitize_title( (string) pll_current_language( 'slug' ) ) : '';
	$sig = $path . '|' . http_build_query( $qv ) . '|l=' . $lang;
	$key = 'vtp_html_' . md5( strtolower( $sig ) );

	$cached = get_transient( $key );
	if ( is_string( $cached ) && '' !== $cached ) {
		if ( ! headers_sent() ) {
			header( 'X-VT-HTML-Cache: HIT' );
		}
		echo $cached;
		exit;
	}
	if ( ! headers_sent() ) {
		header( 'X-VT-HTML-Cache: MISS' );
	}
	ob_start(
		static function ( $html ) use ( $key ) {
			if ( is_string( $html ) && strlen( $html ) > 1200 && 200 === intval( http_response_code() ) ) {
				// Longer cache window significantly improves mobile TTFB on shared hosting.
				set_transient( $key, $html, 30 * MINUTE_IN_SECONDS );
			}
			return $html;
		}
	);
}
add_action( 'template_redirect', 'vtportal_start_html_cache', 1 );

// Optional modules loaded from the same plugin directory.
$vt_news_module = plugin_dir_path( __FILE__ ) . 'vt-news-aggregator.php';
if ( file_exists( $vt_news_module ) ) {
	require_once $vt_news_module;
}

class Vtuber_CPTS_Plugin {
	public function __construct() {
		add_action( 'init', [ $this, 'register_taxonomies' ] );
		add_action( 'init', [ $this, 'register_post_types' ] );
		add_action( 'acf/init', [ $this, 'register_acf_fields' ] );
		add_action( 'pre_get_posts', [ $this, 'tune_public_queries' ] );
	}

	public function register_post_types() {
		$common = [
			'public'       => true,
			'show_in_rest' => true,
			'supports'     => [ 'title', 'editor', 'thumbnail', 'excerpt', 'revisions' ],
		];

		register_post_type(
			'vtuber',
			array_merge(
				$common,
				[
					'label'  => 'VTuber',
					'labels' => [
						'name'          => 'VTubers',
						'singular_name' => 'VTuber',
					],
					'menu_icon' => 'dashicons-microphone',
					'rewrite'   => [ 'slug' => 'vtuber' ],
					'has_archive' => true,
					// NOTE: "agency" is for actual org/agency only; "indie" belongs in role-tag.
					'taxonomies'=> [ 'agency', 'platform', 'role-tag', 'life-status', 'country', 'debut-year' ],
				]
			)
		);

		register_post_type(
			'voice-actor',
			array_merge(
				$common,
				[
					'label'  => 'Voice Actor',
					'labels' => [
						'name'          => 'Voice Actors',
						'singular_name' => 'Voice Actor',
					],
					'menu_icon' => 'dashicons-id',
					'rewrite'   => [ 'slug' => 'voice-actor' ],
					'has_archive' => true,
					'taxonomies'=> [ 'agency', 'role-tag' ],
				]
			)
		);

		register_post_type(
			'anime-work',
			array_merge(
				$common,
				[
					'label'  => 'Anime Work',
					'labels' => [
						'name'          => 'Anime Works',
						'singular_name' => 'Anime Work',
					],
					'menu_icon' => 'dashicons-format-video',
					'rewrite'   => [ 'slug' => 'anime' ],
					'has_archive' => true,
					'taxonomies'=> [ 'franchise' ],
				]
			)
		);

		register_post_type(
			'character',
			array_merge(
				$common,
				[
					'label'  => 'Character',
					'labels' => [
						'name'          => 'Characters',
						'singular_name' => 'Character',
					],
					'menu_icon' => 'dashicons-smiley',
					'rewrite'   => [ 'slug' => 'character' ],
					'has_archive' => true,
					'taxonomies'=> [ 'franchise', 'role-tag' ],
				]
			)
		);

		register_post_type(
			'vt-suggestion',
			[
				'label'         => 'VT Suggestions',
				'labels'        => [
					'name'          => 'VT Suggestions',
					'singular_name' => 'VT Suggestion',
					'add_new_item'  => 'Add Suggestion',
					'edit_item'     => 'Edit Suggestion',
				],
				'public'        => false,
				'publicly_queryable' => false,
				'show_ui'       => true,
				'show_in_menu'  => true,
				'show_in_rest'  => false,
				'menu_icon'     => 'dashicons-feedback',
				'supports'      => [ 'title', 'editor' ],
				'capability_type' => 'post',
				'map_meta_cap'  => true,
			]
		);
	}

	public function register_taxonomies() {
		register_taxonomy(
			'agency',
			[ 'vtuber', 'voice-actor' ],
			[
				'label'        => 'Agency / Org',
				'public'       => true,
				'show_in_rest' => true,
				'hierarchical' => true,
				'rewrite'      => [ 'slug' => 'agency' ],
			]
		);

		register_taxonomy(
			'country',
			[ 'vtuber' ],
			[
				'label'        => 'Country / Region',
				'public'       => true,
				'show_in_rest' => true,
				'hierarchical' => true,
				'rewrite'      => [ 'slug' => 'country' ],
			]
		);

		register_taxonomy(
			'platform',
			[ 'vtuber' ],
			[
				'label'        => 'Platform',
				'public'       => true,
				'show_in_rest' => true,
				'hierarchical' => false,
				'rewrite'      => [ 'slug' => 'platform' ],
			]
		);

		register_taxonomy(
			'debut-year',
			[ 'vtuber' ],
			[
				'label'        => 'Debut Year',
				'public'       => true,
				'show_in_rest' => true,
				'hierarchical' => false,
				'rewrite'      => [ 'slug' => 'debut-year' ],
			]
		);

		register_taxonomy(
			'franchise',
			[ 'anime-work', 'character' ],
			[
				'label'        => 'Franchise / Series',
				'public'       => true,
				'show_in_rest' => true,
				'hierarchical' => true,
				'rewrite'      => [ 'slug' => 'franchise' ],
			]
		);

		register_taxonomy(
			'role-tag',
			[ 'vtuber', 'voice-actor', 'character' ],
			[
				'label'        => 'Role Tags',
				'public'       => true,
				'show_in_rest' => true,
				'hierarchical' => false,
				'rewrite'      => [ 'slug' => 'role' ],
			]
		);

		register_taxonomy(
			'life-status',
			[ 'vtuber' ],
			[
				'label'        => 'Lifecycle',
				'public'       => true,
				'show_in_rest' => true,
				'hierarchical' => false,
				'rewrite'      => [ 'slug' => 'life-status' ],
			]
		);
	}

	public function register_acf_fields() {
		if ( ! function_exists( 'acf_add_local_field_group' ) ) {
			return;
		}

		acf_add_local_field_group(
			[
				'key'                   => 'group_vtuber_profile',
				'title'                 => 'VTuber Profile',
				'fields'                => [
					[
						'key'   => 'vtuber_original_name',
						'label' => 'Original Name',
						'name'  => 'vt_original_name',
						'type'  => 'text',
					],
					[
						'key'   => 'vtuber_display_name',
						'label' => 'Display Name',
						'name'  => 'vt_display_name',
						'type'  => 'text',
					],
					[
						'key'   => 'vtuber_affiliation',
						'label' => 'Affiliation / Org',
						'name'  => 'vt_affiliation',
						'type'  => 'text',
					],
					[
						'key'   => 'vtuber_debut_date',
						'label' => 'Debut Date',
						'name'  => 'vt_debut_date',
						'type'  => 'date_picker',
					],
					[
						'key'   => 'vtuber_birthday',
						'label' => 'Birthday',
						'name'  => 'vt_birthday',
						'type'  => 'text',
					],
					[
						'key'   => 'vtuber_fan_name',
						'label' => 'Fan Name',
						'name'  => 'vt_fan_name',
						'type'  => 'text',
					],
					[
						'key'   => 'vtuber_hashtags',
						'label' => 'Hashtags',
						'name'  => 'vt_hashtags',
						'type'  => 'text',
					],
					[
						'key'   => 'vtuber_youtube_subs',
						'label' => 'YouTube Subs',
						'name'  => 'vt_youtube_subs',
						'type'  => 'number',
					],
					[
						'key'   => 'vtuber_bilibili_subs',
						'label' => 'Bilibili Followers',
						'name'  => 'vt_bilibili_subs',
						'type'  => 'number',
					],
					[
						'key'   => 'vtuber_twitch_followers',
						'label' => 'Twitch Followers',
						'name'  => 'vt_twitch_followers',
						'type'  => 'number',
					],
					[
						'key'   => 'vtuber_rep_video',
						'label' => 'Representative Video URL',
						'name'  => 'vt_rep_video_url',
						'type'  => 'url',
					],
					[
						'key'   => 'vtuber_summary',
						'label' => 'Persona Summary',
						'name'  => 'vt_summary',
						'type'  => 'textarea',
					],
					[
						'key'   => 'vtuber_faq_q1',
						'label' => 'FAQ Q1',
						'name'  => 'vt_faq_q1',
						'type'  => 'text',
					],
					[
						'key'   => 'vtuber_faq_a1',
						'label' => 'FAQ A1',
						'name'  => 'vt_faq_a1',
						'type'  => 'textarea',
					],
					[
						'key'   => 'vtuber_faq_q2',
						'label' => 'FAQ Q2',
						'name'  => 'vt_faq_q2',
						'type'  => 'text',
					],
					[
						'key'   => 'vtuber_faq_a2',
						'label' => 'FAQ A2',
						'name'  => 'vt_faq_a2',
						'type'  => 'textarea',
					],
					[
						'key'   => 'vtuber_faq_q3',
						'label' => 'FAQ Q3',
						'name'  => 'vt_faq_q3',
						'type'  => 'text',
					],
					[
						'key'   => 'vtuber_faq_a3',
						'label' => 'FAQ A3',
						'name'  => 'vt_faq_a3',
						'type'  => 'textarea',
					],
				],
				'location'              => [
					[
						[
							'param'    => 'post_type',
							'operator' => '==',
							'value'    => 'vtuber',
						],
					],
				],
				'show_in_rest'          => 1,
				'active'                => true,
			]
		);

		acf_add_local_field_group(
			[
				'key'      => 'group_voice_actor',
				'title'    => 'Voice Actor Profile',
				'fields'   => [
					[
						'key'   => 'va_native_name',
						'label' => 'Native Name',
						'name'  => 'va_native_name',
						'type'  => 'text',
					],
					[
						'key'   => 'va_stage_name',
						'label' => 'Stage Name',
						'name'  => 'va_stage_name',
						'type'  => 'text',
					],
					[
						'key'   => 'va_birth_date',
						'label' => 'Birth Date',
						'name'  => 'va_birth_date',
						'type'  => 'date_picker',
					],
					[
						'key'   => 'va_agency',
						'label' => 'Agency',
						'name'  => 'va_agency',
						'type'  => 'text',
					],
					[
						'key'   => 'va_debut_year',
						'label' => 'Debut Year',
						'name'  => 'va_debut_year',
						'type'  => 'number',
					],
					[
						'key'   => 'va_notable_roles',
						'label' => 'Notable Roles',
						'name'  => 'va_notable_roles',
						'type'  => 'textarea',
					],
					[
						'key'   => 'va_bio_summary',
						'label' => 'Bio Summary',
						'name'  => 'va_bio_summary',
						'type'  => 'textarea',
					],
				],
				'location' => [
					[
						[
							'param'    => 'post_type',
							'operator' => '==',
							'value'    => 'voice-actor',
						],
					],
				],
				'show_in_rest' => 1,
				'active'       => true,
			]
		);

		acf_add_local_field_group(
			[
				'key'      => 'group_anime_work',
				'title'    => 'Anime Work Info',
				'fields'   => [
					[
						'key'   => 'aw_release_year',
						'label' => 'Release Year',
						'name'  => 'aw_release_year',
						'type'  => 'number',
					],
					[
						'key'   => 'aw_season',
						'label' => 'Season',
						'name'  => 'aw_season',
						'type'  => 'text',
					],
					[
						'key'   => 'aw_studio',
						'label' => 'Studio',
						'name'  => 'aw_studio',
						'type'  => 'text',
					],
					[
						'key'   => 'aw_official_site',
						'label' => 'Official Site',
						'name'  => 'aw_official_site',
						'type'  => 'url',
					],
					[
						'key'   => 'aw_streaming_links',
						'label' => 'Streaming Links',
						'name'  => 'aw_streaming_links',
						'type'  => 'textarea',
					],
					[
						'key'   => 'aw_synopsis',
						'label' => 'Synopsis',
						'name'  => 'aw_synopsis',
						'type'  => 'textarea',
					],
				],
				'location' => [
					[
						[
							'param'    => 'post_type',
							'operator' => '==',
							'value'    => 'anime-work',
						],
					],
				],
				'show_in_rest' => 1,
				'active'       => true,
			]
		);

		acf_add_local_field_group(
			[
				'key'      => 'group_character_profile',
				'title'    => 'Character Profile',
				'fields'   => [
					[
						'key'        => 'char_work_ref',
						'label'      => 'Appears In (Work)',
						'name'       => 'char_work_ref',
						'type'       => 'post_object',
						'post_type'  => [ 'anime-work' ],
						'return_format' => 'id',
					],
					[
						'key'        => 'char_va_ref',
						'label'      => 'Voice Actor',
						'name'       => 'char_va_ref',
						'type'       => 'post_object',
						'post_type'  => [ 'voice-actor' ],
						'return_format' => 'id',
					],
					[
						'key'   => 'char_description',
						'label' => 'Description',
						'name'  => 'char_description',
						'type'  => 'textarea',
					],
				],
				'location' => [
					[
						[
							'param'    => 'post_type',
							'operator' => '==',
							'value'    => 'character',
						],
					],
				],
				'show_in_rest' => 1,
				'active'       => true,
			]
		);
	}

	/**
	 * Tune public archive sizes for better UX.
	 *
	 * WP default is often 10 posts/page which is too small for a database-style archive.
	 */
	public function tune_public_queries( $q ) {
		if ( is_admin() || ! ( $q instanceof WP_Query ) || ! $q->is_main_query() ) {
			return;
		}

		// VTuber archive and its taxonomy archives should show more items per page.
		if ( $q->is_post_type_archive( 'vtuber' ) || $q->is_tax( 'life-status' ) || $q->is_tax( 'agency' ) || $q->is_tax( 'platform' ) || $q->is_tax( 'role-tag' ) || $q->is_tax( 'country' ) || $q->is_tax( 'debut-year' ) ) {
			// Dense enough to reduce pagination while still acceptable on mobile.
			$q->set( 'posts_per_page', 30 );

			// Default sort: YouTube subscribers desc (database-style browsing).
			// Allow override by query param: ?sort=updated
			$sort = isset( $_GET['sort'] ) ? sanitize_key( (string) $_GET['sort'] ) : '';
			if ( 'updated' === $sort ) {
				$q->set( 'orderby', 'modified' );
				$q->set( 'order', 'DESC' );
			} else {
				// Use page-level cache for expensive YouTube-sort queries.
				$cache_key = function_exists( 'vtportal_youtube_sort_page_cache_key' ) ? vtportal_youtube_sort_page_cache_key( $q ) : '';
				if ( '' !== $cache_key ) {
					$cached = get_transient( $cache_key );
					if ( is_array( $cached ) && array_key_exists( 'ids', $cached ) ) {
						$ids = array_values( array_filter( array_map( 'intval', (array) ( $cached['ids'] ?? [] ) ) ) );
						if ( empty( $ids ) ) {
							$ids = [ 0 ];
						}
						$total = max( 0, intval( $cached['total'] ?? 0 ) );
						if ( 0 === $total && ! empty( $ids ) && 0 !== intval( $ids[0] ) ) {
							$total = count( $ids );
						}
						$q->set( 'post__in', $ids );
						$q->set( 'orderby', 'post__in' );
						$q->set( 'order', 'ASC' );
						// The page IDs are already sliced for the requested page.
						// Prevent WP from applying pagination offset again (which causes false 404 on /page/N/).
						$q->set( 'paged', 1 );
						$q->set( 'page', 1 );
						$q->set( 'offset', 0 );
						$q->set( 'no_found_rows', true );
						$q->set( 'vtportal_cached_total', $total );
						$q->set( 'vtportal_sort_cache_hit', 1 );
					} else {
						$q->set( 'vtportal_page_cache_key', $cache_key );
						$q->set( 'vtportal_sort_cache_hit', 0 );
						// Sort by YouTube subs without excluding posts that don't have the meta.
						// (Using WP's `meta_key` would INNER JOIN postmeta and hide entries with no subs yet.)
						$q->set( 'vtportal_sort_by_youtube', 1 );
						$q->set( 'orderby', 'none' );
					}
				} else {
					$q->set( 'vtportal_sort_by_youtube', 1 );
					$q->set( 'orderby', 'none' );
				}
			}
		}
	}
}

new Vtuber_CPTS_Plugin();

/**
 * LEFT JOIN based sort for vt_youtube_subs (keeps posts without meta visible).
 */
add_filter(
	'posts_results',
	function ( $posts, $q ) {
		if ( is_admin() || ! ( $q instanceof WP_Query ) || ! $q->is_main_query() ) {
			return $posts;
		}
		if ( $q->get( 'vtportal_sort_cache_hit' ) ) {
			return $posts;
		}
		$key = (string) $q->get( 'vtportal_page_cache_key' );
		if ( '' === $key ) {
			return $posts;
		}
		$ids = [];
		foreach ( (array) $posts as $p ) {
			$pid = intval( is_object( $p ) ? ( $p->ID ?? 0 ) : 0 );
			if ( $pid > 0 ) {
				$ids[] = $pid;
			}
		}
		$total = max( 0, intval( $q->found_posts ) );
		if ( 0 === $total ) {
			$ppp   = max( 1, intval( $q->get( 'posts_per_page' ) ) );
			$paged = max( 1, intval( $q->get( 'paged' ) ) );
			$total = ( ( $paged - 1 ) * $ppp ) + count( $ids );
		}
		set_transient(
			$key,
			[
				'ids'   => array_values( array_unique( array_map( 'intval', $ids ) ) ),
				'total' => $total,
			],
			HOUR_IN_SECONDS
		);
		return $posts;
	},
	10,
	2
);

add_filter(
	'found_posts',
	function ( $found_posts, $q ) {
		if ( is_admin() || ! ( $q instanceof WP_Query ) || ! $q->is_main_query() ) {
			return $found_posts;
		}
		if ( ! $q->get( 'vtportal_sort_cache_hit' ) ) {
			return $found_posts;
		}
		$total = max( 0, intval( $q->get( 'vtportal_cached_total' ) ) );
		return $total;
	},
	10,
	2
);

add_filter(
	'posts_clauses',
	function ( $clauses, $q ) {
		if ( is_admin() || ! ( $q instanceof WP_Query ) ) {
			return $clauses;
		}
		if ( ! $q->is_main_query() ) {
			return $clauses;
		}
		if ( ! $q->get( 'vtportal_sort_by_youtube' ) ) {
			return $clauses;
		}

		global $wpdb;
		$pm = $wpdb->postmeta;
		$p  = $wpdb->posts;

		// Prevent double-joining if another plugin already joined for this key.
		if ( is_string( $clauses['join'] ?? '' ) && false === strpos( (string) $clauses['join'], 'vt_yt_subs' ) ) {
			$clauses['join'] .= " LEFT JOIN {$pm} AS vt_yt_subs ON ({$p}.ID = vt_yt_subs.post_id AND vt_yt_subs.meta_key = 'vt_youtube_subs') ";
		}

		// Force deterministic ordering: subs desc, then recently updated.
		$clauses['orderby'] = " CAST(vt_yt_subs.meta_value AS UNSIGNED) DESC, {$p}.post_modified_gmt DESC ";
		return $clauses;
	},
	10,
	2
);

add_action(
	'save_post_vtuber',
	function () {
		vtportal_maybe_bump_ytsort_cache_ver();
	},
	20,
	0
);

add_action(
	'deleted_post',
	function ( $post_id ) {
		if ( 'vtuber' === get_post_type( $post_id ) ) {
			vtportal_maybe_bump_ytsort_cache_ver();
		}
	},
	20,
	1
);

add_action(
	'updated_post_meta',
	function ( $meta_id, $post_id, $meta_key ) {
		if ( 'vt_youtube_subs' !== (string) $meta_key ) {
			return;
		}
		if ( 'vtuber' !== get_post_type( intval( $post_id ) ) ) {
			return;
		}
		vtportal_maybe_bump_ytsort_cache_ver();
	},
	20,
	3
);

/**
 * Polylang integration: ensure our CPTs + taxonomies are treated as translatable.
 *
 * Without this, language filtering and REST `lang` scoping can behave inconsistently,
 * causing duplicate listings and mismatched counts across language paths.
 */
add_filter(
	'pll_get_post_types',
	function ( $post_types, $is_settings ) {
		$post_types = is_array( $post_types ) ? $post_types : [];
		// Always expose in settings AND force-enable at runtime.
		foreach ( [ 'vtuber', 'voice-actor', 'anime-work', 'character' ] as $pt ) {
			$post_types[ $pt ] = $pt;
		}
		return $post_types;
	},
	10,
	2
);

add_filter(
	'pll_get_taxonomies',
	function ( $taxes, $is_settings ) {
		$taxes = is_array( $taxes ) ? $taxes : [];
		foreach ( [ 'agency', 'platform', 'role-tag', 'life-status', 'country', 'debut-year', 'franchise' ] as $tx ) {
			$taxes[ $tx ] = $tx;
		}
		return $taxes;
	},
	10,
	2
);

/**
 * Ensure rewrite rules are flushed once after plugin updates.
 */
function vtportal_maybe_flush_rewrites() {
	$flush_version = '20260216_country_debut_year';
	$flag = get_option( 'vtportal_rewrite_flushed' );
	if ( $flag !== $flush_version ) {
		flush_rewrite_rules();
		update_option( 'vtportal_rewrite_flushed', $flush_version );
	}
}
add_action( 'init', 'vtportal_maybe_flush_rewrites' );

/**
 * Frontend templates + assets to render CPT content nicely without touching the active theme.
 */
add_action(
	'wp_enqueue_scripts',
	function () {
		$css_path = VT_PORTAL_DIR . 'assets/vtuber-portal.css';
		$ver      = file_exists( $css_path ) ? (string) filemtime( $css_path ) : '1.0.0';
		wp_enqueue_style(
			'vtuber-portal',
			VT_PORTAL_URL . 'assets/vtuber-portal.css',
			[],
			$ver
		);
	}
);

/**
 * Shared detector for Portal pages where we can safely strip heavy theme assets.
 */
function vtportal_is_portal_context() {
	if ( is_admin() ) {
		return false;
	}
	return is_front_page()
		|| is_post_type_archive( 'vtuber' )
		|| is_singular( 'vtuber' )
		|| is_tax( 'agency' )
		|| is_tax( 'platform' )
		|| is_tax( 'role-tag' )
		|| is_tax( 'life-status' )
		|| is_tax( 'country' )
		|| is_tax( 'debut-year' );
}

/**
 * Performance hardening on Portal pages:
 * - Dequeue Newsmatic CSS/JS not used by Portal templates.
 * - Remove duplicate/legacy FontAwesome + slick stack.
 * - Trim default block/oEmbed assets.
 */
add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! vtportal_is_portal_context() ) {
			return;
		}

		$styles = [
			'newsmatic-style',
			'newsmatic-builder',
			'newsmatic-main-style',
			'newsmatic-loader-style',
			'newsmatic-responsive-style',
			'newsmatic-typo-fonts',
			'fontawesome',
			'fontawesome-6',
			'slick',
			'wp-block-library',
			'wp-block-library-theme',
			'wc-block-style',
			'classic-theme-styles',
			'global-styles',
		];
		foreach ( $styles as $h ) {
			wp_dequeue_style( $h );
		}

		$scripts = [
			'slick',
			'js-marquee',
			'newsmatic-navigation',
			'jquery-cookie',
			'newsmatic-theme',
			'waypoint',
			'wp-embed',
			'jetpack-stats',
			'jetpack-stats-js',
		];
		foreach ( $scripts as $h ) {
			wp_dequeue_script( $h );
		}

		// jQuery is not required by Portal templates; removing it saves critical path time on mobile.
		wp_dequeue_script( 'jquery-migrate' );
		wp_deregister_script( 'jquery-migrate' );
		wp_dequeue_script( 'jquery-core' );
		wp_deregister_script( 'jquery-core' );
		wp_dequeue_script( 'jquery' );
		wp_deregister_script( 'jquery' );
	},
	999
);

/**
 * Remove oEmbed discovery/head JS on Portal pages (not needed and adds extra requests).
 */
add_action(
	'wp',
	function () {
		if ( ! vtportal_is_portal_context() ) {
			return;
		}
		remove_action( 'wp_head', 'wp_oembed_add_discovery_links' );
		remove_action( 'wp_head', 'wp_oembed_add_host_js' );
		// Emoji detection script is not needed for this portal UI and adds inline JS parse cost.
		// Remove both old and new callback names to cover different WP versions.
		remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
		remove_action( 'wp_head', 'wp_print_emoji_detection_script', 7 );
		remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
		remove_action( 'admin_print_scripts', 'wp_print_emoji_detection_script' );
		remove_action( 'wp_print_styles', 'print_emoji_styles' );
		remove_action( 'wp_print_styles', 'wp_print_emoji_styles' );
		remove_action( 'admin_print_styles', 'print_emoji_styles' );
		remove_action( 'admin_print_styles', 'wp_print_emoji_styles' );
		remove_filter( 'the_content_feed', 'wp_staticize_emoji' );
		remove_filter( 'comment_text_rss', 'wp_staticize_emoji' );
		remove_filter( 'wp_mail', 'wp_staticize_emoji_for_email' );
		add_filter( 'emoji_svg_url', '__return_false' );
	},
	1
);

/**
 * Strip duplicate GA loader/snippet injected by older snippets on Portal pages.
 * Keep the MU plugin GA ID (G-B65VCT4SG8), remove legacy G-X1784WWBL0 snippet.
 */
add_action(
	'template_redirect',
	function () {
		if ( ! vtportal_is_portal_context() ) {
			return;
		}
		ob_start(
			static function ( $html ) {
				if ( ! is_string( $html ) || '' === $html ) {
					return $html;
				}
				$html = preg_replace(
					'~<!--\s*HFCM by 99 Robots - Snippet # 1: gtag\s*-->.*?<script[^>]+googletagmanager\.com/gtag/js\?id=G-X1784WWBL0[^>]*></script>\s*<script>.*?gtag\(\s*[\'"]config[\'"]\s*,\s*[\'"]G-X1784WWBL0[\'"]\s*\)\s*;.*?</script>~is',
					'',
					$html
				);
				$html = preg_replace( '~<script[^>]+googletagmanager\.com/gtag/js\?id=G-X1784WWBL0[^>]*></script>~i', '', $html );
				// Jetpack stats is not needed on portal profile/list pages and adds third-party payload.
				$html = preg_replace( '~<script[^>]+stats\.wp\.com/e-[^>]+></script>~i', '', $html );
				$html = preg_replace( '~<img[^>]+stats\.wp\.com/g\.gif[^>]*>~i', '', $html );
				// Strip WP emoji detection payload (JSON + inline bootstrap script) on portal pages.
				$html = preg_replace(
					'~<script[^>]+id=["\']wp-emoji-settings["\'][^>]*>.*?</script>\s*<script>.*?wpEmojiSettingsSupports.*?</script>~is',
					'',
					$html
				);
				return $html;
			}
		);
	},
	0
);

/**
 * Simple language switcher rendering helper.
 */
function vtportal_language_switcher() {
	if ( function_exists( 'pll_the_languages' ) ) {
		echo '<div class="vt-lang-switch">';
		pll_the_languages(
			[
				'dropdown' => 0,
				'display_names_as' => 'slug',
				'show_flags' => 1,
				'hide_if_empty' => 0,
			]
		);
		echo '</div>';
	}
}

/**
 * Render a Polylang-driven language dropdown, but only for the site's public SEO languages.
 *
 * Rationale:
 * - Polylang may contain legacy languages from earlier experiments.
 * - We only want to expose: zh (default no prefix), cn, ja, en, ko, es, hi.
 * - Still uses Polylang's native URL resolution per-context (singular/archive/tax).
 */
function vtportal_allowed_public_lang_slugs() {
	return [ 'zh', 'cn', 'ja', 'en', 'ko', 'es', 'hi' ];
}

function vtportal_render_language_dropdown() {
	if ( ! function_exists( 'pll_the_languages' ) ) {
		return;
	}

	$current = function_exists( 'pll_current_language' ) ? (string) pll_current_language( 'slug' ) : '';
	$allowed = vtportal_allowed_public_lang_slugs();

	// Polylang returns a per-context URL for each language (important for archives).
	$langs = pll_the_languages(
		[
			'raw'            => 1,
			'hide_if_empty'  => 0,
			'show_flags'     => 1,
			'display_names_as' => 'name',
		]
	);
	if ( ! is_array( $langs ) ) {
		$langs = [];
	}

	$by_slug = [];
	foreach ( $langs as $it ) {
		if ( ! is_array( $it ) ) {
			continue;
		}
		$slug = sanitize_title( (string) ( $it['slug'] ?? '' ) );
		if ( '' === $slug ) {
			continue;
		}
		$by_slug[ $slug ] = $it;
	}

	echo '<div class="vt-lang-dropdown">';
	echo '<select class="pll-switcher-select vt-lang-select" onchange="if(this.value){window.location=this.value;}">';
	foreach ( $allowed as $slug ) {
		$it = $by_slug[ $slug ] ?? null;
		$url = '';
		$name = '';
		if ( is_array( $it ) ) {
			$url  = (string) ( $it['url'] ?? '' );
			$name = (string) ( $it['name'] ?? '' );
		}
		if ( '' === $url && function_exists( 'pll_home_url' ) ) {
			$url = (string) pll_home_url( $slug );
		}
		if ( '' === $name && function_exists( 'PLL' ) ) {
			try {
				$lang_obj = PLL()->model->get_language( $slug );
				if ( $lang_obj && isset( $lang_obj->name ) ) {
					$name = (string) $lang_obj->name;
				}
			} catch ( Throwable $e ) {
				// ignore
			}
		}
		if ( '' === $name ) {
			$name = strtoupper( $slug );
		}
		$selected = ( $current !== '' && $slug === $current ) ? ' selected' : '';
		echo '<option value="' . esc_attr( $url ) . '"' . $selected . '>' . esc_html( $name ) . '</option>';
	}
	echo '</select>';
	echo '</div>';
}

/**
 * Check whether a post type currently has published content.
 *
 * Used by templates to hide navigation entries for empty databases
 * (e.g. anime-work) while keeping the feature auto-restorable once
 * content exists again.
 */
function vtportal_has_public_content( $post_type, $lang = '' ) {
	$post_type = sanitize_key( (string) $post_type );
	if ( '' === $post_type ) {
		return false;
	}

	$args = [
		'post_type'      => $post_type,
		'post_status'    => 'publish',
		'posts_per_page' => 1,
		'fields'         => 'ids',
		'no_found_rows'  => false,
	];

	$lang = sanitize_title( (string) $lang );
	if ( '' !== $lang && function_exists( 'pll_current_language' ) ) {
		$args['lang'] = $lang;
	}

	$q = new WP_Query( $args );
	return intval( $q->found_posts ) > 0;
}

/**
 * Normalize Polylang slug to SEO hreflang code.
 */
function vtportal_hreflang_from_lang_slug( $slug ) {
	$slug = strtolower( trim( (string) $slug ) );
	$map  = [
		'zh' => 'zh-Hant',
		'cn' => 'zh-Hans',
		'ja' => 'ja',
		'en' => 'en',
		'ko' => 'ko',
		'es' => 'es',
		'hi' => 'hi',
	];
	return isset( $map[ $slug ] ) ? $map[ $slug ] : $slug;
}

function vtportal_public_lang_allowlist() {
	// Public SEO languages only (avoid leaking legacy/incomplete languages into hreflang).
	return [ 'zh', 'cn', 'ja', 'en', 'ko', 'es', 'hi' ];
}

function vtportal_current_lang_slug_safe() {
	if ( function_exists( 'pll_current_language' ) ) {
		$cur = (string) pll_current_language( 'slug' );
		$cur = sanitize_title( $cur );
		if ( '' !== $cur ) {
			return $cur;
		}
	}
	return 'zh';
}

function vtportal_default_lang_slug_safe() {
	if ( function_exists( 'pll_default_language' ) ) {
		$d = (string) pll_default_language( 'slug' );
		$d = sanitize_title( $d );
		if ( '' !== $d ) {
			return $d;
		}
	}
	return 'zh';
}

/**
 * SEO pack for landing pages (localized).
 */
function vtportal_landing_seo_pack( $lang = '' ) {
	$lang = '' !== $lang ? sanitize_title( (string) $lang ) : vtportal_current_lang_slug_safe();
	$pack = [
		'zh' => [
			'title' => 'USADA｜多語系 VTuber / 聲優 / 動漫資料索引',
			'desc'  => 'USADA 收錄台灣與全球 VTuber 條目、社群連結、訂閱數與代表內容，支援多語查找並持續更新。',
		],
		'cn' => [
			'title' => 'USADA｜多语言 VTuber / 声优 / 动漫资料索引',
			'desc'  => 'USADA 收录台湾与全球 VTuber 条目、社群链接、订阅数据与代表内容，支持多语言检索并持续更新。',
		],
		'ja' => [
			'title' => 'USADA｜多言語VTuber・声優・アニメ情報データベース',
			'desc'  => 'USADAは台湾と世界中のVTuber情報を収録。プロフィール、SNSリンク、登録者指標、関連情報を多言語で検索できます。',
		],
		'en' => [
			'title' => 'USADA | Multilingual VTuber, Voice Actor & Anime Index',
			'desc'  => 'USADA is a multilingual VTuber index with profiles, social links, subscriber metrics, and curated references.',
		],
		'ko' => [
			'title' => 'USADA | VTuber · 성우 · 애니메이션 데이터 허브',
			'desc'  => 'USADA는 VTuber 프로필, 소셜 링크, 구독자 지표를 다국어로 정리한 데이터 인덱스입니다.',
		],
		'es' => [
			'title' => 'USADA | Índice multilingüe de VTubers, seiyuus y anime',
			'desc'  => 'USADA es un índice de VTubers con perfiles, enlaces sociales y métricas, disponible en varios idiomas.',
		],
		'hi' => [
			'title' => 'USADA | बहुभाषी VTuber, Voice Actor और Anime इंडेक्स',
			'desc'  => 'USADA एक बहुभाषी VTuber इंडेक्स है जिसमें प्रोफाइल, सोशल लिंक और सब्सक्राइबर मेट्रिक्स शामिल हैं।',
		],
	];
	return isset( $pack[ $lang ] ) ? $pack[ $lang ] : $pack['zh'];
}

/**
 * Whether current query is a portal landing template page.
 */
function vtportal_is_landing_template_context( $post_id = 0 ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		$post_id = intval( get_queried_object_id() );
	}
	if ( $post_id <= 0 ) {
		return false;
	}
	$tpl = (string) get_page_template_slug( $post_id );
	return in_array( $tpl, [ 'vt-portal-landing.php' ], true );
}

/**
 * Localize SEO output on landing pages, even when Yoast reads untranslated page title/excerpt.
 */
function vtportal_filter_landing_seo_title( $title ) {
	if ( is_admin() || ! vtportal_is_landing_template_context() ) {
		return $title;
	}
	$pack = vtportal_landing_seo_pack();
	return (string) $pack['title'];
}

function vtportal_filter_landing_seo_desc( $desc ) {
	if ( is_admin() || ! vtportal_is_landing_template_context() ) {
		return $desc;
	}
	$pack = vtportal_landing_seo_pack();
	return (string) $pack['desc'];
}

function vtportal_filter_landing_yoast_schema_webpage( $data ) {
	if ( ! is_array( $data ) || is_admin() || ! vtportal_is_landing_template_context() ) {
		return $data;
	}
	$pack = vtportal_landing_seo_pack();
	$data['name']        = (string) $pack['title'];
	$data['description'] = (string) $pack['desc'];
	return $data;
}

function vtportal_filter_landing_yoast_schema_website( $data ) {
	if ( ! is_array( $data ) || is_admin() || ! vtportal_is_landing_template_context() ) {
		return $data;
	}
	$pack = vtportal_landing_seo_pack();
	$data['description'] = (string) $pack['desc'];
	return $data;
}

function vtportal_filter_landing_yoast_schema_breadcrumb( $data ) {
	if ( ! is_array( $data ) || is_admin() || ! vtportal_is_landing_template_context() ) {
		return $data;
	}
	$lang      = vtportal_current_lang_slug_safe();
	$home_name = vtportal_runtime_translate( '首頁', $lang );
	if ( isset( $data['itemListElement'][0]['name'] ) ) {
		$data['itemListElement'][0]['name'] = (string) $home_name;
	}
	return $data;
}

add_filter( 'pre_get_document_title', 'vtportal_filter_landing_seo_title', 20, 1 );
add_filter( 'wpseo_title', 'vtportal_filter_landing_seo_title', 20, 1 );
add_filter( 'wpseo_metadesc', 'vtportal_filter_landing_seo_desc', 20, 1 );
add_filter( 'wpseo_opengraph_title', 'vtportal_filter_landing_seo_title', 20, 1 );
add_filter( 'wpseo_opengraph_desc', 'vtportal_filter_landing_seo_desc', 20, 1 );
add_filter( 'wpseo_twitter_title', 'vtportal_filter_landing_seo_title', 20, 1 );
add_filter( 'wpseo_twitter_description', 'vtportal_filter_landing_seo_desc', 20, 1 );
add_filter( 'wpseo_schema_webpage', 'vtportal_filter_landing_yoast_schema_webpage', 20, 1 );
add_filter( 'wpseo_schema_website', 'vtportal_filter_landing_yoast_schema_website', 20, 1 );
add_filter( 'wpseo_schema_breadcrumb', 'vtportal_filter_landing_yoast_schema_breadcrumb', 20, 1 );

/**
 * Runtime i18n map for vtuber-portal textdomain.
 * This is used because many templates are custom PHP with hardcoded zh-TW strings.
 */
function vtportal_runtime_i18n_map( $lang ) {
	$lang = sanitize_title( (string) $lang );
	$maps = [
		'cn' => [
			'首頁' => '首页',
			'回首頁' => '返回首页',
			'返回 VTuber 列表' => '返回 VTuber 列表',
			'VTuber 列表' => 'VTuber 列表',
			'作品資料庫' => '作品资料库',
			'角色資料庫' => '角色资料库',
			'語言' => '语言',
			'瀏覽 VTuber' => '浏览 VTuber',
			'搜尋 VTuber' => '搜索 VTuber',
			'輸入關鍵字搜尋…' => '输入关键词搜索…',
			'即時比對並顯示相關結果（依關鍵字匹配）' => '实时比对并显示相关结果（按关键词匹配）',
			'近期熱門搜尋' => '近期热门搜索',
			'常用標籤' => '常用标签',
			'瀏覽全部' => '浏览全部',
			'最新更新' => '最新更新',
			'依更新時間排序（最新優先）' => '按更新时间排序（最新优先）',
			'資料更新中' => '资料更新中',
			'最新 VTuber 新聞（外部連結）' => '最新 VTuber 新闻（外部链接）',
			'VTuber 新聞' => 'VTuber 新闻',
			'VTuber 精選' => 'VTuber 精选',
			'收錄出道、粉絲名、代表影片等欄位，方便快速查找。' => '收录出道、粉丝名、代表影片等栏位，方便快速查找。',
			'全部 VTuber' => '全部 VTuber',
			'依平台' => '按平台',
			'依組織' => '按组织',
			'依國家' => '按国家',
			'依出道年' => '按出道年',
			'活動中' => '活动中',
			'轉生 / 前世' => '转生 / 前世',
			'畢業 / 引退' => '毕业 / 引退',
			'休止中' => '休止中',
			'已畢業 / 引退' => '已毕业 / 引退',
			'狀態' => '状态',
			'國家/地區' => '国家/地区',
			'出道年' => '出道年',
			'平台' => '平台',
			'組織' => '组织',
			'標籤' => '标签',
			'分類' => '分类',
			'提交建議' => '提交建议',
			'想補充新 VTuber 或修正資料？可在此提交，我們會在後台審核後更新。' => '想补充新 VTuber 或修正资料？可在此提交，我们会在后台审核后更新。',
			'已收到建議，感謝提交。' => '已收到建议，感谢提交。',
			'名稱' => '名称',
			'連結' => '链接',
			'說明' => '说明',
			'聯絡方式（選填）' => '联系方式（选填）',
			'送出建議' => '提交建议',
			'例如：補充出道日期、社群連結或狀態資訊' => '例如：补充出道日期、社群链接或状态信息',
			'想找特定 Vtuber？' => '想找特定 VTuber？',
			'多語系、可擴充的 VTuber 資料庫，每日可自動新增與更新。' => '多语言、可扩展的 VTuber 资料库，每日可自动新增与更新。',
			'聯絡我們 / 合作投放' => '联系我们 / 合作投放',
			'顯示名' => '显示名',
			'出道' => '出道',
			'生日/設定' => '生日/设定',
			'粉絲名' => '粉丝名',
			'常用 Hashtag' => '常用 Hashtag',
			'所屬組織' => '所属组织',
			'類型' => '类型',
			'Twitch簡介' => 'Twitch 简介',
			'觀看代表影片' => '观看代表影片',
			'常見問答' => '常见问答',
			'完整介紹' => '完整介绍',
			'快速摘要' => '快速摘要',
			'更新時間' => '更新时间',
			'頁面導覽' => '页面导航',
			'回到頂部' => '回到顶部',
			'同組織的 VTuber' => '同组织 VTuber',
			'同平台的 VTuber' => '同平台 VTuber',
			'同國家/地區的 VTuber' => '同国家/地区 VTuber',
			'同組織 VTuber' => '同组织 VTuber',
			'同平台 VTuber' => '同平台 VTuber',
			'同國家 VTuber' => '同国家 VTuber',
			'目前未啟用新聞聚合模組。' => '目前未启用新闻聚合模块。',
			'相關新聞（外部連結）' => '相关新闻（外部链接）',
			'最新新聞（外部連結）' => '最新新闻（外部链接）',
			'僅引用標題與來源，點擊後前往原網站閱讀全文。' => '仅引用标题与来源，点击后前往原网站阅读全文。',
			'依最近更新時間排序（最新優先）' => '按最近更新时间排序（最新优先）',
			'依 YouTube 訂閱數排序（高到低）' => '按 YouTube 订阅数排序（高到低）',
			'YouTube 訂閱' => 'YouTube 订阅',
			'最近更新' => '最近更新',
			'尚無內容。' => '暂无内容。',
			'此語系資料仍在建立中，請稍後再試。' => '该语系资料仍在建立中，请稍后再试。',
			'棉花糖' => '棉花糖',
			'抖內 / Donate' => '打赏 / Donate',
			'官方 / 所屬' => '官方 / 所属',
			'%d 個條目' => '%d 个条目',
			'7日更新' => '7日更新',
		],
		'en' => [
			'首頁' => 'Home',
			'回首頁' => 'Home',
			'返回 VTuber 列表' => 'Back to VTuber List',
			'VTuber 列表' => 'VTuber List',
			'作品資料庫' => 'Works Database',
			'角色資料庫' => 'Character Database',
			'語言' => 'Language',
			'瀏覽 VTuber' => 'Browse VTubers',
			'搜尋 VTuber' => 'Search VTubers',
			'輸入關鍵字搜尋…' => 'Type keywords to search...',
			'即時比對並顯示相關結果（依關鍵字匹配）' => 'Live suggestions by keyword match',
			'近期熱門搜尋' => 'Trending Searches',
			'常用標籤' => 'Popular Tags',
			'瀏覽全部' => 'View All',
			'最新更新' => 'Latest Updates',
			'依更新時間排序（最新優先）' => 'Sorted by update time (newest first)',
			'資料更新中' => 'Updating',
			'最新 VTuber 新聞（外部連結）' => 'Latest VTuber News (External Links)',
			'VTuber 新聞' => 'VTuber News',
			'VTuber 精選' => 'Featured VTubers',
			'收錄出道、粉絲名、代表影片等欄位，方便快速查找。' => 'Find debut info, fan names, representative videos, and more.',
			'全部 VTuber' => 'All VTubers',
			'依平台' => 'By Platform',
			'依組織' => 'By Agency',
			'依國家' => 'By Country',
			'依出道年' => 'By Debut Year',
			'活動中' => 'Active',
			'轉生 / 前世' => 'Reincarnated / Past Life',
			'畢業 / 引退' => 'Graduated / Retired',
			'休止中' => 'Hiatus',
			'已畢業 / 引退' => 'Graduated / Retired',
			'狀態' => 'Status',
			'國家/地區' => 'Country / Region',
			'出道年' => 'Debut Year',
			'平台' => 'Platform',
			'組織' => 'Agency',
			'標籤' => 'Tag',
			'分類' => 'Category',
			'提交建議' => 'Submit Suggestion',
			'想補充新 VTuber 或修正資料？可在此提交，我們會在後台審核後更新。' => 'Suggest new VTubers or data fixes. Submissions are reviewed before publishing.',
			'已收到建議，感謝提交。' => 'Suggestion received. Thank you.',
			'名稱' => 'Name',
			'連結' => 'Link',
			'說明' => 'Note',
			'聯絡方式（選填）' => 'Contact (Optional)',
			'送出建議' => 'Submit',
			'例如：補充出道日期、社群連結或狀態資訊' => 'e.g. debut date, social links, status update',
			'想找特定 Vtuber？' => 'Looking for a specific VTuber?',
			'多語系、可擴充的 VTuber 資料庫，每日可自動新增與更新。' => 'A multilingual VTuber database with daily updates.',
			'聯絡我們 / 合作投放' => 'Contact / Partnerships',
			'顯示名' => 'Display Name',
			'出道' => 'Debut',
			'生日/設定' => 'Birthday / Lore',
			'粉絲名' => 'Fan Name',
			'常用 Hashtag' => 'Common Hashtags',
			'所屬組織' => 'Affiliation',
			'類型' => 'Type',
			'Twitch簡介' => 'Twitch Bio',
			'觀看代表影片' => 'Watch Representative Video',
			'常見問答' => 'FAQ',
			'完整介紹' => 'Full Profile',
			'快速摘要' => 'Quick Summary',
			'更新時間' => 'Updated At',
			'頁面導覽' => 'Page Navigation',
			'回到頂部' => 'Back to Top',
			'同組織的 VTuber' => 'VTubers from the Same Agency',
			'同平台的 VTuber' => 'VTubers on the Same Platform',
			'同國家/地區的 VTuber' => 'VTubers in the Same Region',
			'同組織 VTuber' => 'Same Agency',
			'同平台 VTuber' => 'Same Platform',
			'同國家 VTuber' => 'Same Country',
			'目前未啟用新聞聚合模組。' => 'News aggregation module is not enabled.',
			'相關新聞（外部連結）' => 'Related News (External Links)',
			'最新新聞（外部連結）' => 'Latest News (External Links)',
			'僅引用標題與來源，點擊後前往原網站閱讀全文。' => 'Only title and source are shown. Click to read the full article on the original site.',
			'依最近更新時間排序（最新優先）' => 'Sorted by latest update time',
			'依 YouTube 訂閱數排序（高到低）' => 'Sorted by YouTube subscribers (high to low)',
			'YouTube 訂閱' => 'YouTube Subs',
			'最近更新' => 'Recently Updated',
			'尚無內容。' => 'No content yet.',
			'此語系資料仍在建立中，請稍後再試。' => 'This language dataset is still being built. Please check back later.',
			'棉花糖' => 'Marshmallow',
			'抖內 / Donate' => 'Donate',
			'官方 / 所屬' => 'Official / Affiliation',
			'%d 個條目' => '%d entries',
			'7日更新' => 'Updated in 7 Days',
		],
		'ja' => [
			'首頁' => 'ホーム',
			'回首頁' => 'ホームへ',
			'VTuber 列表' => 'VTuber一覧',
			'返回 VTuber 列表' => 'VTuber一覧へ戻る',
			'作品資料庫' => '作品データベース',
			'角色資料庫' => 'キャラクターデータベース',
			'語言' => '言語',
			'瀏覽 VTuber' => 'VTuberを見る',
			'搜尋 VTuber' => 'VTuberを検索',
			'VTuber 精選' => '注目VTuber',
			'最新更新' => '最新更新',
			'依更新時間排序（最新優先）' => '更新日時順（新しい順）',
			'僅引用標題與來源，點擊後前往原網站閱讀全文。' => 'タイトルと出典のみ表示します。クリックすると元サイトへ移動します。',
			'出道' => 'デビュー',
			'粉絲名' => 'ファンネーム',
			'常見問答' => 'よくある質問',
			'完整介紹' => '詳細紹介',
			'Twitch簡介' => 'Twitch紹介',
			'%d 個條目' => '%d件',
		],
		'ko' => [
			'首頁' => '홈',
			'回首頁' => '홈으로',
			'VTuber 列表' => 'VTuber 목록',
			'返回 VTuber 列表' => 'VTuber 목록으로',
			'作品資料庫' => '작품 데이터베이스',
			'角色資料庫' => '캐릭터 데이터베이스',
			'語言' => '언어',
			'瀏覽 VTuber' => 'VTuber 둘러보기',
			'搜尋 VTuber' => 'VTuber 검색',
			'VTuber 精選' => '추천 VTuber',
			'最新更新' => '최신 업데이트',
			'依更新時間排序（最新優先）' => '업데이트 순 정렬 (최신 우선)',
			'僅引用標題與來源，點擊後前往原網站閱讀全文。' => '제목과 출처만 표시합니다. 클릭하면 원문 사이트로 이동합니다.',
			'出道' => '데뷔',
			'粉絲名' => '팬덤명',
			'常見問答' => '자주 묻는 질문',
			'完整介紹' => '상세 소개',
			'Twitch簡介' => 'Twitch 소개',
			'%d 個條目' => '%d개 항목',
		],
		'es' => [
			'首頁' => 'Inicio',
			'回首頁' => 'Volver al inicio',
			'VTuber 列表' => 'Lista de VTubers',
			'返回 VTuber 列表' => 'Volver a la lista de VTubers',
			'作品資料庫' => 'Base de obras',
			'角色資料庫' => 'Base de personajes',
			'語言' => 'Idioma',
			'瀏覽 VTuber' => 'Explorar VTubers',
			'搜尋 VTuber' => 'Buscar VTubers',
			'VTuber 精選' => 'VTubers destacados',
			'最新更新' => 'Últimas actualizaciones',
			'依更新時間排序（最新優先）' => 'Ordenado por fecha de actualización (más reciente primero)',
			'僅引用標題與來源，點擊後前往原網站閱讀全文。' => 'Solo mostramos título y fuente. Haz clic para leer el artículo completo en el sitio original.',
			'出道' => 'Debut',
			'粉絲名' => 'Nombre del fandom',
			'常見問答' => 'Preguntas frecuentes',
			'完整介紹' => 'Perfil completo',
			'Twitch簡介' => 'Bio de Twitch',
			'%d 個條目' => '%d elementos',
		],
		'hi' => [
			'首頁' => 'होम',
			'回首頁' => 'होम पर लौटें',
			'VTuber 列表' => 'VTuber सूची',
			'返回 VTuber 列表' => 'VTuber सूची पर वापस जाएँ',
			'作品資料庫' => 'कृतियाँ डेटाबेस',
			'角色資料庫' => 'चरित्र डेटाबेस',
			'語言' => 'भाषा',
			'瀏覽 VTuber' => 'VTuber ब्राउज़ करें',
			'搜尋 VTuber' => 'VTuber खोजें',
			'VTuber 精選' => 'चयनित VTubers',
			'最新更新' => 'नवीनतम अपडेट',
			'依更新時間排序（最新優先）' => 'अपडेट समय के अनुसार क्रम (नवीनतम पहले)',
			'僅引用標題與來源，點擊後前往原網站閱讀全文。' => 'केवल शीर्षक और स्रोत दिखाए जाते हैं। पूरा लेख पढ़ने के लिए मूल साइट पर जाएँ।',
			'出道' => 'डेब्यू',
			'粉絲名' => 'फैन नाम',
			'常見問答' => 'सामान्य प्रश्न',
			'完整介紹' => 'पूर्ण परिचय',
			'Twitch簡介' => 'Twitch परिचय',
			'%d 個條目' => '%d प्रविष्टियाँ',
		],
	];
	return isset( $maps[ $lang ] ) ? $maps[ $lang ] : [];
}

/**
 * Clean runtime i18n map (UTF-8 safe).
 *
 * Reason:
 * - Historical map entries include mojibake from earlier encoding migrations.
 * - Keep this map small and focused on high-visibility UI strings.
 * - This map is checked before legacy map to ensure stable multilingual UX.
 */
function vtportal_runtime_i18n_map_clean( $lang ) {
	$lang = sanitize_title( (string) $lang );
	$maps = [
		'ja' => [
			'首頁' => 'ホーム',
			'回首頁' => 'ホームへ戻る',
			'Home' => 'ホーム',
			'返回 VTuber 列表' => 'VTuber一覧へ戻る',
			'VTuber 列表' => 'VTuber一覧',
			'VTubers' => 'VTuber数',
			'作品資料庫' => '作品データベース',
			'角色資料庫' => 'キャラクターデータベース',
			'語言' => '言語',
			'Language' => '言語',
			'瀏覽 VTuber' => 'VTuberを見る',
			'搜尋 VTuber' => 'VTuberを検索',
			'輸入關鍵字搜尋…' => 'キーワードを入力して検索…',
			'即時比對並顯示相關結果（依關鍵字匹配）' => 'キーワード一致で候補を即時表示',
			'近期熱門搜尋' => '最近の人気検索',
			'常用標籤' => 'よく使うタグ',
			'瀏覽全部' => 'すべて表示',
			'最新更新' => '最新更新',
			'依更新時間排序（最新優先）' => '更新日時順（新しい順）',
			'資料更新中' => '更新中',
			'VTuber 新聞' => 'VTuberニュース',
			'最新 VTuber 新聞（外部連結）' => '最新VTuberニュース（外部リンク）',
			'VTuber 精選' => '注目VTuber',
			'收錄出道、粉絲名、代表影片等欄位，方便快速查找。' => 'デビュー日・ファンネーム・代表動画などをまとめて素早く検索できます。',
			'全部 VTuber' => 'すべてのVTuber',
			'依平台' => 'プラットフォーム別',
			'依組織' => '所属別',
			'依國家' => '国・地域別',
			'依出道年' => 'デビュー年別',
			'活動中' => '活動中',
			'轉生 / 前世' => '転生 / 前世',
			'畢業 / 引退' => '卒業 / 引退',
			'休止中' => '活動休止中',
			'已畢業 / 引退' => '卒業 / 引退',
			'狀態' => 'ステータス',
			'國家/地區' => '国・地域',
			'出道年' => 'デビュー年',
			'平台' => 'プラットフォーム',
			'組織' => '所属',
			'標籤' => 'タグ',
			'分類' => '分類',
			'提交建議' => '提案を送信',
			'想補充新 VTuber 或修正資料？可在此提交，我們會在後台審核後更新。' => '新規VTuberの追加や情報修正はこちらから送信できます。審査後に反映します。',
			'已收到建議，感謝提交。' => '提案を受け付けました。ありがとうございます。',
			'名稱' => '名称',
			'連結' => 'リンク',
			'說明' => '説明',
			'聯絡方式（選填）' => '連絡先（任意）',
			'送出建議' => '送信',
			'例如：補充出道日期、社群連結或狀態資訊' => '例：デビュー日、SNSリンク、ステータス情報の補足',
			'想找特定 Vtuber？' => '特定のVTuberを探していますか？',
			'多語系、可擴充的 VTuber 資料庫，每日可自動新增與更新。' => '多言語対応の拡張可能なVTuberデータベース。毎日自動更新されます。',
			'聯絡我們 / 合作投放' => 'お問い合わせ / 提携',
			'顯示名' => '表示名',
			'出道' => 'デビュー',
			'生日/設定' => '誕生日 / 設定',
			'粉絲名' => 'ファンネーム',
			'常用 Hashtag' => 'よく使うハッシュタグ',
			'所屬組織' => '所属組織',
			'類型' => 'タイプ',
			'Twitch簡介' => 'Twitch紹介',
			'觀看代表影片' => '代表動画を見る',
			'常見問答' => 'よくある質問',
			'完整介紹' => '詳細紹介',
			'快速摘要' => 'クイック要約',
			'更新時間' => '更新日時',
			'頁面導覽' => 'ページナビ',
			'回到頂部' => 'トップへ戻る',
			'同組織的 VTuber' => '同じ所属のVTuber',
			'同平台的 VTuber' => '同じプラットフォームのVTuber',
			'同國家/地區的 VTuber' => '同じ国・地域のVTuber',
			'同組織 VTuber' => '同じ所属',
			'同平台 VTuber' => '同じプラットフォーム',
			'同國家 VTuber' => '同じ国・地域',
			'目前未啟用新聞聚合模組。' => 'ニュース集約モジュールは現在無効です。',
			'相關新聞（外部連結）' => '関連ニュース（外部リンク）',
			'最新新聞（外部連結）' => '最新ニュース（外部リンク）',
			'僅引用標題與來源，點擊後前往原網站閱讀全文。' => '見出しと出典のみ表示します。クリックで元サイトの全文へ移動します。',
			'依最近更新時間排序（最新優先）' => '最近更新順（新しい順）',
			'依 YouTube 訂閱數排序（高到低）' => 'YouTube登録者数順（多い順）',
			'YouTube 訂閱' => 'YouTube登録者数',
			'最近更新' => '最近更新',
			'尚無內容。' => 'まだコンテンツがありません。',
			'此語系資料仍在建立中，請稍後再試。' => 'この言語のデータは構築中です。しばらくしてから再度お試しください。',
			'棉花糖' => 'マシュマロ',
			'抖內 / Donate' => '投げ銭 / Donate',
			'官方 / 所屬' => '公式 / 所属',
			'%d 個條目' => '%d件',
			'7日更新' => '7日内更新',
			'返回聲優列表' => '声優一覧へ戻る',
			'查看 VTuber' => 'VTuberを見る',
			'聲優資料庫' => '声優データベース',
			'本名/原名' => '本名/原名',
			'藝名' => '芸名',
			'生日' => '誕生日',
			'經紀公司' => '所属事務所',
			'代表角色' => '代表キャラクター',
			'人物介紹' => '人物紹介',
			'返回角色列表' => 'キャラクター一覧へ戻る',
			'相關作品' => '関連作品',
			'角色介紹' => 'キャラクター紹介',
			'Voice Actor' => '声優',
			'Character' => 'キャラクター',
			'VTuber Profile' => 'VTuberプロフィール',
		],
		'ko' => [
			'首頁' => '홈',
			'回首頁' => '홈으로',
			'Home' => '홈',
			'VTuber 列表' => 'VTuber 목록',
			'VTubers' => 'VTuber 수',
			'返回 VTuber 列表' => 'VTuber 목록으로',
			'作品資料庫' => '작품 DB',
			'角色資料庫' => '캐릭터 DB',
			'語言' => '언어',
			'Language' => '언어',
			'瀏覽 VTuber' => 'VTuber 보기',
			'搜尋 VTuber' => 'VTuber 검색',
			'最新更新' => '최신 업데이트',
			'常用標籤' => '인기 태그',
			'YouTube 訂閱' => 'YouTube 구독자',
			'最近更新' => '최근 업데이트',
			'活動中' => '활동중',
			'休止中' => '휴식중',
			'畢業 / 引退' => '졸업 / 은퇴',
			'轉生 / 前世' => '전생 / 전신',
			'尚無內容。' => '콘텐츠가 없습니다.',
			'此語系資料仍在建立中，請稍後再試。' => '이 언어 데이터는 구축 중입니다. 잠시 후 다시 시도해 주세요.',
		],
		'es' => [
			'首頁' => 'Inicio',
			'回首頁' => 'Volver al inicio',
			'Home' => 'Inicio',
			'VTuber 列表' => 'Lista de VTubers',
			'VTubers' => 'VTubers',
			'返回 VTuber 列表' => 'Volver a la lista de VTubers',
			'作品資料庫' => 'Base de obras',
			'角色資料庫' => 'Base de personajes',
			'語言' => 'Idioma',
			'Language' => 'Idioma',
			'瀏覽 VTuber' => 'Explorar VTubers',
			'搜尋 VTuber' => 'Buscar VTubers',
			'最新更新' => 'Últimas actualizaciones',
			'常用標籤' => 'Etiquetas populares',
			'YouTube 訂閱' => 'Suscriptores de YouTube',
			'最近更新' => 'Actualizado recientemente',
			'活動中' => 'Activo',
			'休止中' => 'En pausa',
			'畢業 / 引退' => 'Graduado / Retirado',
			'轉生 / 前世' => 'Reencarnado / Vida pasada',
			'尚無內容。' => 'Sin contenido por ahora.',
			'此語系資料仍在建立中，請稍後再試。' => 'Los datos de este idioma aún se están construyendo. Inténtalo de nuevo más tarde.',
		],
		'hi' => [
			'首頁' => 'होम',
			'回首頁' => 'होम पर वापस',
			'Home' => 'होम',
			'VTuber 列表' => 'VTuber सूची',
			'VTubers' => 'VTubers',
			'返回 VTuber 列表' => 'VTuber सूची पर वापस',
			'作品資料庫' => 'कृतियाँ डेटाबेस',
			'角色資料庫' => 'किरदार डेटाबेस',
			'語言' => 'भाषा',
			'Language' => 'भाषा',
			'瀏覽 VTuber' => 'VTuber देखें',
			'搜尋 VTuber' => 'VTuber खोजें',
			'最新更新' => 'नवीनतम अपडेट',
			'常用標籤' => 'लोकप्रिय टैग',
			'YouTube 訂閱' => 'YouTube सदस्य',
			'最近更新' => 'हालिया अपडेट',
			'活動中' => 'सक्रिय',
			'休止中' => 'विराम में',
			'畢業 / 引退' => 'स्नातक / सेवानिवृत्त',
			'轉生 / 前世' => 'पुनर्जन्म / पूर्व रूप',
			'尚無內容。' => 'अभी सामग्री नहीं है।',
			'此語系資料仍在建立中，請稍後再試。' => 'इस भाषा का डेटा अभी तैयार किया जा रहा है। कृपया बाद में पुनः प्रयास करें।',
		],
	];
	return isset( $maps[ $lang ] ) ? $maps[ $lang ] : [];
}

function vtportal_runtime_translate( $text, $lang = '' ) {
	$text = (string) $text;
	if ( '' === $text ) {
		return $text;
	}
	$lang = '' !== $lang ? sanitize_title( (string) $lang ) : vtportal_current_lang_slug_safe();
	if ( '' === $lang || 'zh' === $lang ) {
		return $text;
	}
	static $cache = [];
	static $clean_cache = [];
	if ( ! isset( $clean_cache[ $lang ] ) ) {
		$clean_cache[ $lang ] = vtportal_runtime_i18n_map_clean( $lang );
	}
	$clean_map = $clean_cache[ $lang ];
	if ( isset( $clean_map[ $text ] ) ) {
		return (string) $clean_map[ $text ];
	}

	if ( ! isset( $cache[ $lang ] ) ) {
		$cache[ $lang ] = vtportal_runtime_i18n_map( $lang );
	}
	$map = $cache[ $lang ];
	if ( isset( $map[ $text ] ) ) {
		return (string) $map[ $text ];
	}
	// For non-zh non-cn languages, fallback to English map to avoid visible Traditional Chinese UI.
	if ( ! in_array( $lang, [ 'zh', 'cn', 'en' ], true ) ) {
		if ( ! isset( $cache['en'] ) ) {
			$cache['en'] = vtportal_runtime_i18n_map( 'en' );
		}
		if ( isset( $cache['en'][ $text ] ) ) {
			return (string) $cache['en'][ $text ];
		}
	}
	return $text;
}

function vtportal_runtime_gettext_filter( $translated, $text, $domain ) {
	if ( 'vtuber-portal' !== (string) $domain ) {
		return $translated;
	}
	return vtportal_runtime_translate( (string) $text );
}

function vtportal_runtime_ngettext_filter( $translated, $single, $plural, $number, $domain ) {
	if ( 'vtuber-portal' !== (string) $domain ) {
		return $translated;
	}
	$target = ( intval( $number ) === 1 ) ? (string) $single : (string) $plural;
	$out    = vtportal_runtime_translate( $target );
	// Keep sprintf placeholders in translated branch.
	return ( '' !== $out ) ? $out : $translated;
}

add_filter( 'gettext', 'vtportal_runtime_gettext_filter', 20, 3 );
add_filter( 'ngettext', 'vtportal_runtime_ngettext_filter', 20, 5 );

/**
 * Runtime term-label translation for front-end taxonomy chips/titles.
 * This covers places where templates print $term->name directly.
 */
function vtportal_term_label_translate( $name, $taxonomy = '', $lang = '' ) {
	$name = trim( (string) $name );
	if ( '' === $name ) {
		return $name;
	}
	$taxonomy = sanitize_key( (string) $taxonomy );
	$lang     = '' !== $lang ? sanitize_title( (string) $lang ) : vtportal_current_lang_slug_safe();
	if ( '' === $lang || 'zh' === $lang ) {
		return $name;
	}

	$maps = [
		'en' => [
			'活動中' => 'Active',
			'休止中' => 'Hiatus',
			'畢業 / 引退' => 'Graduated / Retired',
			'已畢業 / 引退' => 'Graduated / Retired',
			'轉生 / 前世' => 'Reincarnated / Past Life',
			'個人勢' => 'Indie',
			'企業勢' => 'Corporate',
			'社團勢' => 'Group',
			'台灣' => 'Taiwan',
			'臺灣' => 'Taiwan',
			'日本' => 'Japan',
			'韓國' => 'South Korea',
			'中國' => 'China',
			'香港' => 'Hong Kong',
			'美國' => 'United States',
			'馬來西亞' => 'Malaysia',
			'印尼' => 'Indonesia',
		],
		'ja' => [
			'活動中' => '活動中',
			'休止中' => '活動休止中',
			'畢業 / 引退' => '卒業 / 引退',
			'已畢業 / 引退' => '卒業 / 引退',
			'轉生 / 前世' => '転生 / 前世',
			'企業勢' => '企業勢',
			'社團勢' => 'サークル勢',
			'台灣' => '台湾',
			'臺灣' => '台湾',
			'韓國' => '韓国',
			'中國' => '中国',
			'美國' => 'アメリカ',
		],
		'ko' => [
			'活動中' => '활동중',
			'休止中' => '휴식중',
			'畢業 / 引退' => '졸업 / 은퇴',
			'已畢業 / 引退' => '졸업 / 은퇴',
			'轉生 / 前世' => '전생 / 전신',
			'個人勢' => '인디',
			'企業勢' => '기업',
			'社團勢' => '그룹',
			'台灣' => '대만',
			'臺灣' => '대만',
			'日本' => '일본',
			'韓國' => '대한민국',
			'中國' => '중국',
			'香港' => '홍콩',
			'美國' => '미국',
		],
		'es' => [
			'活動中' => 'Activo',
			'休止中' => 'En pausa',
			'畢業 / 引退' => 'Graduado / Retirado',
			'已畢業 / 引退' => 'Graduado / Retirado',
			'轉生 / 前世' => 'Reencarnado / Vida pasada',
			'個人勢' => 'Indie',
			'企業勢' => 'Corporativo',
			'社團勢' => 'Grupo',
			'台灣' => 'Taiwán',
			'臺灣' => 'Taiwán',
			'日本' => 'Japón',
			'韓國' => 'Corea del Sur',
			'中國' => 'China',
			'香港' => 'Hong Kong',
			'美國' => 'Estados Unidos',
		],
		'hi' => [
			'活動中' => 'सक्रिय',
			'休止中' => 'विराम में',
			'畢業 / 引退' => 'स्नातक / सेवानिवृत्त',
			'已畢業 / 引退' => 'स्नातक / सेवानिवृत्त',
			'轉生 / 前世' => 'पुनर्जन्म / पूर्व रूप',
			'個人勢' => 'इंडी',
			'企業勢' => 'कॉर्पोरेट',
			'社團勢' => 'समूह',
			'台灣' => 'ताइवान',
			'臺灣' => 'ताइवान',
			'日本' => 'जापान',
			'韓國' => 'दक्षिण कोरिया',
			'中國' => 'चीन',
			'香港' => 'हांगकांग',
			'美國' => 'संयुक्त राज्य',
		],
		'cn' => [
			'臺灣' => '台湾',
			'韓國' => '韩国',
			'美國' => '美国',
			'畢業 / 引退' => '毕业 / 引退',
			'已畢業 / 引退' => '毕业 / 引退',
			'轉生 / 前世' => '转生 / 前世',
		],
	];

	// Optional taxonomy-level guard to avoid over-translating arbitrary labels.
	$allowed_tax = [ 'life-status', 'agency', 'role-tag', 'country' ];
	if ( '' !== $taxonomy && ! in_array( $taxonomy, $allowed_tax, true ) ) {
		return $name;
	}

	$map = $maps[ $lang ] ?? [];
	if ( isset( $map[ $name ] ) ) {
		return (string) $map[ $name ];
	}
	return $name;
}

function vtportal_runtime_filter_get_term_name( $term, $taxonomy = '' ) {
	if ( is_admin() || ! $term || is_wp_error( $term ) || ! is_object( $term ) || empty( $term->name ) ) {
		return $term;
	}
	$tax = '' !== $taxonomy ? (string) $taxonomy : (string) ( $term->taxonomy ?? '' );
	$term->name = vtportal_term_label_translate( (string) $term->name, $tax );
	return $term;
}

function vtportal_runtime_filter_get_terms_name( $terms, $taxonomies = [], $args = [], $term_query = null ) {
	if ( is_admin() || ! is_array( $terms ) || empty( $terms ) ) {
		return $terms;
	}
	foreach ( $terms as $idx => $term ) {
		if ( ! $term || is_wp_error( $term ) || ! is_object( $term ) || empty( $term->name ) ) {
			continue;
		}
		$tax = (string) ( $term->taxonomy ?? '' );
		$terms[ $idx ]->name = vtportal_term_label_translate( (string) $term->name, $tax );
	}
	return $terms;
}

add_filter( 'get_term', 'vtportal_runtime_filter_get_term_name', 20, 2 );
add_filter( 'get_terms', 'vtportal_runtime_filter_get_terms_name', 20, 4 );

/**
 * Lightweight snippet localization for excerpts/summaries shown on non-zh pages.
 * This does not attempt full machine translation, only high-impact VTuber terms.
 */
function vtportal_localize_snippet_text( $text, $lang = '' ) {
	$text = (string) $text;
	if ( '' === trim( $text ) ) {
		return $text;
	}
	$lang = '' !== $lang ? sanitize_title( (string) $lang ) : vtportal_current_lang_slug_safe();
	if ( '' === $lang || 'zh' === $lang ) {
		return $text;
	}

	$maps = [
		'en' => [
			'個人勢' => 'Indie',
			'企業勢' => 'Corporate',
			'社團勢' => 'Group',
			'活動中' => 'Active',
			'休止中' => 'Hiatus',
			'畢業' => 'Graduated',
			'引退' => 'Retired',
			'轉生' => 'Reincarnated',
			'前世' => 'Past life',
			'停止活動' => 'inactive',
		],
		'ja' => [
			'企業勢' => '企業勢',
			'社團勢' => 'サークル勢',
			'休止中' => '活動休止中',
			'畢業' => '卒業',
			'引退' => '引退',
			'轉生' => '転生',
			'前世' => '前世',
		],
		'ko' => [
			'個人勢' => '인디',
			'企業勢' => '기업',
			'社團勢' => '그룹',
			'活動中' => '활동중',
			'休止中' => '휴식중',
			'畢業' => '졸업',
			'引退' => '은퇴',
			'轉生' => '전생',
			'前世' => '전신',
		],
		'es' => [
			'個人勢' => 'Indie',
			'企業勢' => 'Corporativo',
			'社團勢' => 'Grupo',
			'活動中' => 'Activo',
			'休止中' => 'En pausa',
			'畢業' => 'Graduado',
			'引退' => 'Retirado',
			'轉生' => 'Reencarnado',
			'前世' => 'Vida pasada',
		],
		'hi' => [
			'個人勢' => 'इंडी',
			'企業勢' => 'कॉर्पोरेट',
			'社團勢' => 'समूह',
			'活動中' => 'सक्रिय',
			'休止中' => 'विराम में',
			'畢業' => 'स्नातक',
			'引退' => 'सेवानिवृत्त',
			'轉生' => 'पुनर्जन्म',
			'前世' => 'पूर्व रूप',
		],
		'cn' => [
			'臺灣' => '台湾',
			'轉生' => '转生',
		],
	];

	$map = $maps[ $lang ] ?? [];
	if ( empty( $map ) ) {
		return $text;
	}
	return strtr( $text, $map );
}

function vtportal_runtime_filter_excerpt_localize( $excerpt, $post = null ) {
	if ( is_admin() ) {
		return $excerpt;
	}
	$lang = vtportal_current_lang_slug_safe();
	if ( '' === $lang || 'zh' === $lang ) {
		return $excerpt;
	}
	if ( $post instanceof WP_Post && 'vtuber' !== (string) $post->post_type ) {
		return $excerpt;
	}
	return vtportal_localize_snippet_text( (string) $excerpt, $lang );
}

add_filter( 'get_the_excerpt', 'vtportal_runtime_filter_excerpt_localize', 20, 2 );

function vtportal_request_path_only() {
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '/';
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	$path = '/' . ltrim( $path, '/' );
	return $path;
}

function vtportal_strip_lang_prefix_from_path( $path, $lang_slug ) {
	$path = '/' . ltrim( (string) $path, '/' );
	$lang_slug = sanitize_title( (string) $lang_slug );
	$default = vtportal_default_lang_slug_safe();
	if ( '' === $lang_slug || $lang_slug === $default || 'zh' === $lang_slug ) {
		return $path;
	}
	$prefix = '/' . $lang_slug . '/';
	if ( 0 === strpos( $path, $prefix ) ) {
		return '/' . ltrim( substr( $path, strlen( $prefix ) ), '/' );
	}
	return $path;
}

function vtportal_prefix_lang_to_path( $path, $lang_slug ) {
	$path = '/' . ltrim( (string) $path, '/' );
	$lang_slug = sanitize_title( (string) $lang_slug );
	$default = vtportal_default_lang_slug_safe();
	if ( '' === $lang_slug || $lang_slug === $default || 'zh' === $lang_slug ) {
		return $path;
	}
	return '/' . $lang_slug . $path;
}

function vtportal_is_sort_variant_request() {
	$sort = isset( $_GET['sort'] ) ? sanitize_key( (string) $_GET['sort'] ) : '';
	return ( '' !== $sort );
}

function vtportal_seo_maybe_noindex_for_sort_variants() {
	if ( ! vtportal_is_sort_variant_request() ) {
		return;
	}
	// Sorting variants are useful for UX but thin for SEO (duplicate content).
	// If Yoast is active, we set robots via wpseo_robots filter to avoid duplicate/conflicting tags.
	if ( defined( 'WPSEO_VERSION' ) ) {
		return;
	}
	echo "<meta name=\"robots\" content=\"noindex,follow\">\n";
}

function vtportal_wpseo_robots_noindex_for_sort_variants( $robots ) {
	if ( vtportal_is_sort_variant_request() ) {
		return 'noindex,follow';
	}
	return $robots;
}
if ( defined( 'WPSEO_VERSION' ) ) {
	add_filter( 'wpseo_robots', 'vtportal_wpseo_robots_noindex_for_sort_variants', 10, 1 );
}

/**
 * Print canonical + hreflang links for translated post/page objects.
 */
function vtportal_should_emit_manual_seo_alternates( $context = 'generic' ) {
	if ( ! defined( 'WPSEO_VERSION' ) ) {
		return true;
	}
	$context = sanitize_key( (string) $context );
	// In practice, Yoast often covers archive/term alternates but may miss custom singles.
	$default = in_array( $context, [ 'single', 'vtuber-single' ], true );
	return (bool) apply_filters( 'vtportal_force_manual_hreflang_with_yoast', $default, $context );
}

function vtportal_render_polylang_seo_links_for_post( $post_id ) {
	$post_id = intval( $post_id );
	if ( $post_id <= 0 ) {
		return;
	}

	$canonical = get_permalink( $post_id );
	// Avoid duplicate canonicals if Yoast (or similar) is present.
	if ( $canonical && ! defined( 'WPSEO_VERSION' ) ) {
		echo '<link rel="canonical" href="' . esc_url( $canonical ) . '">' . "\n";
	}
	$post_type = (string) get_post_type( $post_id );
	$ctx = ( 'vtuber' === $post_type ) ? 'vtuber-single' : 'page';
	if ( ! vtportal_should_emit_manual_seo_alternates( $ctx ) ) {
		return;
	}

	if ( ! function_exists( 'pll_languages_list' ) || ! function_exists( 'pll_get_post' ) ) {
		return;
	}

	$langs = vtportal_public_lang_allowlist();
	if ( empty( $langs ) || ! is_array( $langs ) ) {
		return;
	}

	$alt_urls = [];
	$current_slug = function_exists( 'pll_get_post_language' ) ? (string) pll_get_post_language( $post_id, 'slug' ) : '';
	if ( '' === $current_slug && function_exists( 'pll_current_language' ) ) {
		$current_slug = (string) pll_current_language( 'slug' );
	}
	if ( '' !== $current_slug && $canonical ) {
		$alt_urls[ vtportal_hreflang_from_lang_slug( $current_slug ) ] = $canonical;
	}
	foreach ( $langs as $lang_slug ) {
		$tr_id = pll_get_post( $post_id, $lang_slug );
		if ( ! $tr_id ) {
			continue;
		}
		$url = get_permalink( intval( $tr_id ) );
		if ( ! $url ) {
			continue;
		}
		$hreflang = vtportal_hreflang_from_lang_slug( $lang_slug );
		$alt_urls[ $hreflang ] = $url;
	}
	foreach ( $alt_urls as $hreflang => $url ) {
		echo '<link rel="alternate" hreflang="' . esc_attr( $hreflang ) . '" href="' . esc_url( $url ) . '">' . "\n";
	}

	$default_slug = function_exists( 'pll_default_language' ) ? pll_default_language( 'slug' ) : '';
	$default_hf   = vtportal_hreflang_from_lang_slug( $default_slug );
	if ( '' !== $default_hf && isset( $alt_urls[ $default_hf ] ) ) {
		echo '<link rel="alternate" hreflang="x-default" href="' . esc_url( $alt_urls[ $default_hf ] ) . '">' . "\n";
	} elseif ( $canonical ) {
		echo '<link rel="alternate" hreflang="x-default" href="' . esc_url( $canonical ) . '">' . "\n";
	}
}

/**
 * Print canonical + hreflang links for language-prefixed archives (e.g. /cn/vtuber/).
 * Also noindex sort variants (?sort=...).
 */
function vtportal_render_polylang_seo_links_for_archive() {
	$cur = vtportal_current_lang_slug_safe();
	$path = vtportal_request_path_only();
	$norm = vtportal_strip_lang_prefix_from_path( $path, $cur );

	$canonical = home_url( $path );
	vtportal_seo_maybe_noindex_for_sort_variants();
	if ( ! defined( 'WPSEO_VERSION' ) ) {
		echo '<link rel="canonical" href="' . esc_url( $canonical ) . '">' . "\n";
	}
	if ( ! vtportal_should_emit_manual_seo_alternates( 'archive' ) ) {
		return;
	}

	$alt_urls = [];
	foreach ( vtportal_public_lang_allowlist() as $slug ) {
		$alt_path = vtportal_prefix_lang_to_path( $norm, $slug );
		$url = home_url( $alt_path );
		$alt_urls[ vtportal_hreflang_from_lang_slug( $slug ) ] = $url;
	}
	foreach ( $alt_urls as $hreflang => $url ) {
		echo '<link rel="alternate" hreflang="' . esc_attr( $hreflang ) . '" href="' . esc_url( $url ) . '">' . "\n";
	}
	$default_slug = vtportal_default_lang_slug_safe();
	$default_hf   = vtportal_hreflang_from_lang_slug( $default_slug );
	if ( isset( $alt_urls[ $default_hf ] ) ) {
		echo '<link rel="alternate" hreflang="x-default" href="' . esc_url( $alt_urls[ $default_hf ] ) . '">' . "\n";
	}
}

/**
 * Print canonical + hreflang links for taxonomy term pages.
 * We try Polylang term translations first; if missing, we fall back to suffix-based term slugs.
 */
function vtportal_render_polylang_seo_links_for_term( $term ) {
	if ( ! ( $term instanceof WP_Term ) ) {
		return;
	}
	$canonical = get_term_link( $term );
	if ( is_wp_error( $canonical ) ) {
		return;
	}

	vtportal_seo_maybe_noindex_for_sort_variants();
	if ( ! defined( 'WPSEO_VERSION' ) ) {
		echo '<link rel="canonical" href="' . esc_url( $canonical ) . '">' . "\n";
	}
	if ( ! vtportal_should_emit_manual_seo_alternates( 'term' ) ) {
		return;
	}

	$taxonomy = (string) $term->taxonomy;
	$slug_now = (string) $term->slug;
	$base_slug = preg_replace( '/-(zh|cn|en|ko|es|hi)$/i', '', $slug_now );
	$alt_urls = [];

	foreach ( vtportal_public_lang_allowlist() as $lang_slug ) {
		$url = '';
		$tid = 0;
		if ( function_exists( 'pll_get_term' ) ) {
			$tid = intval( pll_get_term( intval( $term->term_id ), $lang_slug ) );
		}
		if ( $tid > 0 ) {
			$u = get_term_link( intval( $tid ), $taxonomy );
			if ( ! is_wp_error( $u ) ) {
				$url = (string) $u;
			}
		}
		if ( '' === $url ) {
			$sfx = ( 'zh' === $lang_slug ) ? 'zh' : $lang_slug;
			$cand_slug = $base_slug . '-' . $sfx;
			$t2 = get_term_by( 'slug', $cand_slug, $taxonomy );
			if ( $t2 && ! is_wp_error( $t2 ) ) {
				$u = get_term_link( $t2, $taxonomy );
				if ( ! is_wp_error( $u ) ) {
					$url = (string) $u;
				}
			}
		}
		if ( '' !== $url ) {
			$alt_urls[ vtportal_hreflang_from_lang_slug( $lang_slug ) ] = $url;
		}
	}

	foreach ( $alt_urls as $hreflang => $url ) {
		echo '<link rel="alternate" hreflang="' . esc_attr( $hreflang ) . '" href="' . esc_url( $url ) . '">' . "\n";
	}
	$default_slug = vtportal_default_lang_slug_safe();
	$default_hf   = vtportal_hreflang_from_lang_slug( $default_slug );
	if ( isset( $alt_urls[ $default_hf ] ) ) {
		echo '<link rel="alternate" hreflang="x-default" href="' . esc_url( $alt_urls[ $default_hf ] ) . '">' . "\n";
	}
}

/**
 * Canonicalize common social URLs (best-effort) for de-dupe keys.
 * This intentionally strips tracking/query and normalizes host + path.
 */
function vtportal_clean_social_url_for_key( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return '';
	}
	// Add scheme when missing.
	if ( ! preg_match( '#^https?://#i', $url ) && preg_match( '/^[A-Za-z0-9_.-]+\\.[A-Za-z]{2,}\\/.+$/', $url ) ) {
		$url = 'https://' . $url;
	}
	if ( ! preg_match( '#^https?://#i', $url ) ) {
		return '';
	}

	$p = wp_parse_url( $url );
	if ( ! is_array( $p ) ) {
		return esc_url_raw( $url );
	}
	$host = strtolower( (string) ( $p['host'] ?? '' ) );
	$path = (string) ( $p['path'] ?? '/' );
	$path = '/' . ltrim( $path, '/' );
	$host = preg_replace( '/^www\\./i', '', $host );

	// YouTube
	if ( in_array( $host, [ 'youtube.com', 'm.youtube.com', 'music.youtube.com' ], true ) ) {
		if ( preg_match( '#^/channel/(UC[0-9A-Za-z_-]{20,})#', $path, $m ) ) {
			return 'https://www.youtube.com/channel/' . $m[1];
		}
		if ( preg_match( '#^/@([0-9A-Za-z_.-]{2,})#', $path, $m ) ) {
			return 'https://www.youtube.com/@' . strtolower( $m[1] );
		}
		return esc_url_raw( 'https://www.youtube.com' . rtrim( $path, '/' ) );
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

	// Generic: keep scheme+host+path only.
	if ( '' === $host ) {
		return '';
	}
	return esc_url_raw( 'https://' . $host . rtrim( $path, '/' ) );
}

/**
 * Lightweight search endpoint for the homepage typeahead.
 *
 * We avoid using WP core `wp/v2/vtuber?search=` directly because:
 * - Polylang language scoping via REST is not guaranteed (depends on add-ons/settings),
 * - returning mixed-language duplicates harms UX.
 */
add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'vtportal/v1',
			'/search',
			[
				'methods'             => 'GET',
				'permission_callback' => '__return_true',
				'callback'            => function ( WP_REST_Request $req ) {
					$q = trim( sanitize_text_field( (string) $req->get_param( 'q' ) ) );
					$lang = sanitize_title( (string) $req->get_param( 'lang' ) );
					$per  = intval( $req->get_param( 'per_page' ) );
					$per  = max( 3, min( 12, $per > 0 ? $per : 6 ) );

					if ( mb_strlen( $q ) < 2 ) {
						return [];
					}

					$args = [
						'post_type'      => 'vtuber',
						'post_status'    => 'publish',
						's'              => $q,
						'posts_per_page' => $per * 3, // fetch extra then de-dupe
						'fields'         => 'ids',
						'no_found_rows'  => true,
					];

					if ( function_exists( 'pll_current_language' ) ) {
						if ( '' === $lang ) {
							$lang = (string) pll_current_language( 'slug' );
						}
						// Polylang supports `lang` in WP_Query in our theme/templates; use it here too.
						if ( '' !== $lang ) {
							$args['lang'] = $lang;
						}
					}

					$qq = new WP_Query( $args );
					$ids = is_array( $qq->posts ) ? array_map( 'intval', (array) $qq->posts ) : [];
					wp_reset_postdata();

					$seen  = [];
					$out   = [];
					foreach ( $ids as $id ) {
						if ( $id <= 0 ) {
							continue;
						}
						$title = (string) get_the_title( $id );
						$disp_b64 = (string) get_post_meta( $id, 'vt_display_b64', true );
						if ( '' !== $disp_b64 ) {
							$decoded = base64_decode( $disp_b64, true );
							if ( $decoded ) {
								$title = (string) $decoded;
							}
						}

						// Skip obvious junk.
						$t = trim( wp_strip_all_tags( $title ) );
						if ( mb_strlen( $t ) < 2 || false !== strpos( $t, '??' ) ) {
							continue;
						}

						$yt = vtportal_clean_social_url_for_key( (string) get_post_meta( $id, 'vt_youtube_url', true ) );
						$tw = vtportal_clean_social_url_for_key( (string) get_post_meta( $id, 'vt_twitch_url', true ) );
						$ytid = trim( (string) get_post_meta( $id, 'vt_youtube_channel_id', true ) );
						$twlogin = trim( (string) get_post_meta( $id, 'vt_twitch_login', true ) );
						$xhandle = trim( (string) get_post_meta( $id, 'vt_twitter_handle', true ) );

						// Derive stable IDs from URLs if maintain hasn't backfilled yet (best-effort).
						if ( '' === $twlogin && '' !== $tw && preg_match( '~twitch\\.tv/([^/?#]+)~i', $tw, $m2 ) ) {
							$twlogin = strtolower( trim( (string) $m2[1] ) );
						}
						$ythandle = '';
						if ( '' === $ytid && '' !== $yt && preg_match( '~youtube\\.com/channel/(UC[0-9A-Za-z_-]{20,})~i', $yt, $m0 ) ) {
							$ytid = (string) $m0[1];
						} elseif ( '' === $ytid && '' !== $yt && preg_match( '~youtube\\.com/@([0-9A-Za-z_.-]{2,})~i', $yt, $m1 ) ) {
							$ythandle = strtolower( (string) $m1[1] );
						}
						if ( '' === $xhandle ) {
							$x = vtportal_clean_social_url_for_key( (string) get_post_meta( $id, 'vt_twitter_url', true ) );
							if ( '' !== $x && preg_match( '~(?:x\\.com|twitter\\.com)/([^/?#]+)~i', $x, $m3 ) ) {
								$xhandle = strtolower( preg_replace( '/[^0-9a-z_]/i', '', (string) $m3[1] ) );
							}
						}

						$key = '';
						if ( '' !== $ytid ) {
							$key = 'ytid|' . strtolower( $ytid );
						} elseif ( '' !== $ythandle ) {
							$key = 'ythandle|' . strtolower( $ythandle );
						} elseif ( '' !== $twlogin ) {
							$key = 'twlogin|' . strtolower( $twlogin );
						} elseif ( '' !== $xhandle ) {
							$key = 'xhandle|' . strtolower( $xhandle );
						} elseif ( '' !== trim( $yt ) ) {
							$key = 'yt|' . $yt;
						} elseif ( '' !== trim( $tw ) ) {
							$key = 'tw|' . $tw;
						} else {
							$key = 't|' . strtolower( preg_replace( '/[^\p{L}\p{N}]+/u', '', $t ) );
						}
						if ( isset( $seen[ $key ] ) ) {
							continue;
						}
						$seen[ $key ] = 1;

						$out[] = [
							'id'    => $id,
							'title' => $t,
							'link'  => get_permalink( $id ),
						];
						if ( count( $out ) >= $per ) {
							break;
						}
					}
					return $out;
				},
			]
		);

		// Public suggestion intake (stores to non-public CPT: vt-suggestion).
		register_rest_route(
			'vtportal/v1',
			'/suggest',
			[
				'methods'             => 'POST',
				'permission_callback' => '__return_true',
				'callback'            => function ( WP_REST_Request $req ) {
					// Basic rate-limit (best-effort).
					$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : '';
					$ip_key = $ip !== '' ? 'vt_suggest_rl_' . md5( $ip ) : 'vt_suggest_rl_anon';
					if ( get_transient( $ip_key ) ) {
						return new WP_REST_Response( [ 'ok' => false, 'error' => 'rate_limited' ], 429 );
					}
					set_transient( $ip_key, 1, 60 );

					// Honeypot for bots.
					$website = (string) $req->get_param( 'website' );
					if ( '' !== trim( $website ) ) {
						return new WP_REST_Response( [ 'ok' => true ], 200 );
					}

					$name    = trim( sanitize_text_field( (string) $req->get_param( 'name' ) ) );
					$contact = trim( sanitize_text_field( (string) $req->get_param( 'contact' ) ) );
					$subject = trim( sanitize_text_field( (string) $req->get_param( 'vtuber' ) ) );
					$platform = trim( sanitize_text_field( (string) $req->get_param( 'platform' ) ) );
					$url     = trim( esc_url_raw( (string) $req->get_param( 'url' ) ) );
					$msg     = trim( wp_kses_post( (string) $req->get_param( 'message' ) ) );
					$lang    = sanitize_title( (string) $req->get_param( 'lang' ) );

					if ( mb_strlen( $subject ) < 2 || mb_strlen( $msg ) < 5 ) {
						return new WP_REST_Response( [ 'ok' => false, 'error' => 'invalid' ], 400 );
					}
					if ( mb_strlen( $subject ) > 120 ) {
						$subject = mb_substr( $subject, 0, 120 );
					}
					if ( mb_strlen( $msg ) > 4000 ) {
						$msg = mb_substr( $msg, 0, 4000 );
					}

					$post_id = wp_insert_post(
						[
							'post_type'    => 'vt-suggestion',
							'post_status'  => 'pending',
							'post_title'   => $subject,
							'post_content' => $msg,
						],
						true
					);
					if ( is_wp_error( $post_id ) ) {
						return new WP_REST_Response( [ 'ok' => false, 'error' => 'insert_failed' ], 500 );
					}

					update_post_meta( intval( $post_id ), 'suggest_platform', $platform );
					update_post_meta( intval( $post_id ), 'suggest_url', $url );
					update_post_meta( intval( $post_id ), 'suggest_contact', $contact );
					update_post_meta( intval( $post_id ), 'suggest_lang', $lang );
					update_post_meta( intval( $post_id ), 'suggest_ip', $ip );
					update_post_meta( intval( $post_id ), 'suggest_name', $name );
					update_post_meta( intval( $post_id ), 'suggest_source', 'rest' );
					$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
					update_post_meta( intval( $post_id ), 'suggest_ua', $ua );

					return [ 'ok' => true, 'id' => intval( $post_id ) ];
				},
			]
		);
	}
);

/**
 * Resolve plugin template if a custom one exists.
 */
function vtportal_template_loader( $template ) {
	if ( empty( $GLOBALS['post'] ) ) {
		return $template;
	}

	$map = [
		'vtuber'      => 'single-vtuber.php',
		'voice-actor' => 'single-voice-actor.php',
		'anime-work'  => 'single-anime-work.php',
		'character'   => 'single-character.php',
	];

	$type = $GLOBALS['post']->post_type;
	if ( isset( $map[ $type ] ) ) {
		$plugin_template = VT_PORTAL_DIR . 'templates/' . $map[ $type ];
		if ( file_exists( $plugin_template ) ) {
			return $plugin_template;
		}
	}

	return $template;
}

add_filter( 'single_template', 'vtportal_template_loader' );

/**
 * Archive template loader for our CPTs.
 */
function vtportal_archive_loader( $template ) {
	if ( is_post_type_archive( [ 'vtuber', 'voice-actor', 'anime-work', 'character' ] ) ) {
		$type    = get_query_var( 'post_type' );
		$map     = [
			'vtuber'      => 'archive-vtuber.php',
			'voice-actor' => 'archive-voice-actor.php',
			'anime-work'  => 'archive-anime-work.php',
			'character'   => 'archive-character.php',
		];
		$desired = isset( $map[ $type ] ) ? $map[ $type ] : '';
		if ( $desired ) {
			$plugin_template = VT_PORTAL_DIR . 'templates/' . $desired;
			if ( file_exists( $plugin_template ) ) {
				return $plugin_template;
			}
		}
	}

	return $template;
}

add_filter( 'archive_template', 'vtportal_archive_loader' );

/**
 * Taxonomy template loader for our taxonomies.
 * This prevents falling back to the theme's old archive UI when users click terms (agency/platform/role-tag/etc.).
 */
function vtportal_taxonomy_loader( $template ) {
	if ( is_tax( [ 'agency', 'platform', 'role-tag', 'franchise', 'life-status', 'country', 'debut-year' ] ) ) {
		$obj = get_queried_object();
		$tax = is_object( $obj ) && ! empty( $obj->taxonomy ) ? $obj->taxonomy : get_query_var( 'taxonomy' );
		$map = [
			'agency'    => 'taxonomy-agency.php',
			'platform'  => 'taxonomy-platform.php',
			'role-tag'  => 'taxonomy-role-tag.php',
			'franchise' => 'taxonomy-franchise.php',
			'life-status' => 'taxonomy-life-status.php',
			'country'   => 'taxonomy-country.php',
			'debut-year' => 'taxonomy-debut-year.php',
		];
		if ( $tax && isset( $map[ $tax ] ) ) {
			$candidate = VT_PORTAL_DIR . 'templates/' . $map[ $tax ];
			if ( file_exists( $candidate ) ) {
				return $candidate;
			}
		}
	}
	return $template;
}
add_filter( 'taxonomy_template', 'vtportal_taxonomy_loader' );

/**
 * Frontend suggestion intake (landing page form -> admin list).
 */
function vtportal_handle_suggestion_submit() {
	if ( 'POST' !== $_SERVER['REQUEST_METHOD'] ) {
		wp_die( 'Invalid request method.' );
	}

	// Best-effort rate-limit by IP (prevents spam bursts).
	$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : '';
	$ip_key = $ip !== '' ? 'vt_suggest_form_rl_' . md5( $ip ) : 'vt_suggest_form_rl_anon';
	if ( get_transient( $ip_key ) ) {
		wp_safe_redirect( add_query_arg( 'vt_suggest', 'rate_limited', wp_get_referer() ?: home_url( '/' ) ) );
		exit;
	}
	set_transient( $ip_key, 1, 60 );

	$nonce = isset( $_POST['vt_suggestion_nonce'] ) ? sanitize_text_field( wp_unslash( $_POST['vt_suggestion_nonce'] ) ) : '';
	if ( ! wp_verify_nonce( $nonce, 'vt_suggestion_submit' ) ) {
		wp_safe_redirect( add_query_arg( 'vt_suggest', 'bad_nonce', wp_get_referer() ?: home_url( '/' ) ) );
		exit;
	}

	$name     = isset( $_POST['suggest_name'] ) ? sanitize_text_field( wp_unslash( $_POST['suggest_name'] ) ) : '';
	$platform = isset( $_POST['suggest_platform'] ) ? sanitize_text_field( wp_unslash( $_POST['suggest_platform'] ) ) : '';
	$url      = isset( $_POST['suggest_url'] ) ? esc_url_raw( wp_unslash( $_POST['suggest_url'] ) ) : '';
	$note     = isset( $_POST['suggest_note'] ) ? sanitize_textarea_field( wp_unslash( $_POST['suggest_note'] ) ) : '';
	$contact  = isset( $_POST['suggest_contact'] ) ? sanitize_text_field( wp_unslash( $_POST['suggest_contact'] ) ) : '';

	if ( '' === trim( $name ) ) {
		wp_safe_redirect( add_query_arg( 'vt_suggest', 'missing_name', wp_get_referer() ?: home_url( '/' ) ) );
		exit;
	}

	$post_id = wp_insert_post(
		[
			'post_type'    => 'vt-suggestion',
			'post_status'  => 'pending',
			'post_title'   => $name,
			'post_content' => $note,
		],
		true
	);

	if ( is_wp_error( $post_id ) ) {
		wp_safe_redirect( add_query_arg( 'vt_suggest', 'failed', wp_get_referer() ?: home_url( '/' ) ) );
		exit;
	}

	update_post_meta( $post_id, 'suggest_platform', $platform );
	update_post_meta( $post_id, 'suggest_url', $url );
	update_post_meta( $post_id, 'suggest_contact', $contact );
	update_post_meta( $post_id, 'suggest_source', 'landing_form' );
	update_post_meta( $post_id, 'suggest_ip', $ip );
	$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
	update_post_meta( $post_id, 'suggest_ua', $ua );
	if ( function_exists( 'pll_current_language' ) ) {
		update_post_meta( $post_id, 'suggest_lang', (string) pll_current_language( 'slug' ) );
	}

	wp_safe_redirect( add_query_arg( 'vt_suggest', 'ok', wp_get_referer() ?: home_url( '/' ) ) );
	exit;
}
add_action( 'admin_post_nopriv_vt_submit_suggestion', 'vtportal_handle_suggestion_submit' );
add_action( 'admin_post_vt_submit_suggestion', 'vtportal_handle_suggestion_submit' );

/**
 * Suggestion admin columns.
 */
function vtportal_suggestion_columns( $columns ) {
	return [
		'cb'       => $columns['cb'] ?? '<input type="checkbox" />',
		'title'    => 'Name',
		'platform' => 'Platform',
		'url'      => 'URL',
		'contact'  => 'Contact',
		'date'     => 'Date',
	];
}
add_filter( 'manage_vt-suggestion_posts_columns', 'vtportal_suggestion_columns' );

function vtportal_suggestion_column_content( $column, $post_id ) {
	if ( 'platform' === $column ) {
		echo esc_html( (string) get_post_meta( $post_id, 'suggest_platform', true ) );
	}
	if ( 'url' === $column ) {
		$url = (string) get_post_meta( $post_id, 'suggest_url', true );
		if ( $url ) {
			echo '<a href="' . esc_url( $url ) . '" target="_blank" rel="noopener">' . esc_html( $url ) . '</a>';
		}
	}
	if ( 'contact' === $column ) {
		echo esc_html( (string) get_post_meta( $post_id, 'suggest_contact', true ) );
	}
}
add_action( 'manage_vt-suggestion_posts_custom_column', 'vtportal_suggestion_column_content', 10, 2 );

/**
 * Redirect legacy theme archives (category/tag/date/author/blog index) back to portal entry.
 * This prevents users from landing on old theme pages through stale links.
 */
function vtportal_redirect_legacy_archives() {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() ) {
		return;
	}
	if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
		return;
	}
	if ( is_feed() || is_trackback() || is_preview() ) {
		return;
	}

	$request_path = '';
	if ( isset( $_SERVER['REQUEST_URI'] ) ) {
		$request_path = (string) wp_parse_url( (string) $_SERVER['REQUEST_URI'], PHP_URL_PATH );
	}
	$legacy_path_hit = false;
	if ( $request_path ) {
		$legacy_prefixes = [ '/category/', '/tag/', '/author/', '/archives/', '/archive/' ];
		foreach ( $legacy_prefixes as $prefix ) {
			if ( 0 === strpos( $request_path, $prefix ) ) {
				$legacy_path_hit = true;
				break;
			}
		}
		if ( preg_match( '#^/[0-9]{4}/[0-9]{1,2}/#', $request_path ) ) {
			$legacy_path_hit = true;
		}
	}

	if ( is_category() || is_tag() || is_author() || is_date() || is_home() || $legacy_path_hit ) {
		$target = get_post_type_archive_link( 'vtuber' );
		if ( ! $target ) {
			$target = home_url( '/' );
		}
		wp_safe_redirect( $target, 301 );
		exit;
	}
}
add_action( 'template_redirect', 'vtportal_redirect_legacy_archives', 1 );

/**
 * Card grid shortcode for quick landing pages.
 * Usage: [vtuber_grid type="vtuber" count="12"]
 */
function vtportal_render_grid_shortcode( $atts ) {
	$atts = shortcode_atts(
		[
			'type'  => 'vtuber',
			'count' => 12,
		],
		$atts
	);

	$allowed = [ 'vtuber', 'voice-actor', 'anime-work', 'character' ];
	if ( ! in_array( $atts['type'], $allowed, true ) ) {
		return '';
	}

	$q = new WP_Query(
		[
			'post_type'      => $atts['type'],
			'posts_per_page' => intval( $atts['count'] ),
			'no_found_rows'  => true,
		]
	);

	if ( ! $q->have_posts() ) {
		return '';
	}

	ob_start();
	echo '<div class="vt-card-grid">';
	while ( $q->have_posts() ) {
		$q->the_post();
		$id   = get_the_ID();
		$link = get_permalink( $id );
		$thumb = get_the_post_thumbnail( $id, 'medium', [ 'class' => 'vt-card-thumb', 'alt' => esc_attr( get_the_title( $id ) ) ] );
		$title = get_the_title( $id );
		$excerpt = wp_trim_words( get_the_excerpt( $id ), 22 );

		echo '<article class="vt-card">';
		if ( $thumb ) {
			echo '<a href="' . esc_url( $link ) . '" class="vt-card-thumb-wrap">' . $thumb . '</a>';
		}
		echo '<div class="vt-card-body">';
		echo '<h3 class="vt-card-title"><a href="' . esc_url( $link ) . '">' . esc_html( $title ) . '</a></h3>';
		echo '<p class="vt-card-excerpt">' . esc_html( $excerpt ) . '</p>';
		echo '</div>';
		echo '</article>';
	}
	wp_reset_postdata();
	echo '</div>';

	return ob_get_clean();
}
add_shortcode( 'vtuber_grid', 'vtportal_render_grid_shortcode' );

/**
 * Register a custom landing page template (lives inside the plugin).
 */
add_filter(
	'theme_page_templates',
	function ( $templates ) {
		$templates['vt-portal-landing.php'] = 'VTuber Portal Landing';
		$templates['vt-platform-index.php'] = 'VT Platform Index';
		$templates['vt-agency-index.php']   = 'VT Agency Index';
		$templates['vt-country-index.php']  = 'VT Country Index';
		$templates['vt-debut-year-index.php'] = 'VT Debut Year Index';
		$templates['vt-role-index.php']     = 'VT Role Index';
		$templates['vt-contact.php']        = 'VT Contact';
		return $templates;
	}
);

/**
 * Load the landing page template from the plugin directory when selected.
 */
add_filter(
	'page_template',
	function ( $template ) {
		$selected = get_page_template_slug();
		$allowed = [
			'vt-portal-landing.php',
			'vt-platform-index.php',
			'vt-agency-index.php',
			'vt-country-index.php',
			'vt-debut-year-index.php',
			'vt-role-index.php',
			'vt-contact.php',
		];
		if ( in_array( $selected, $allowed, true ) ) {
			$candidate = VT_PORTAL_DIR . 'templates/' . $selected;
			if ( file_exists( $candidate ) ) {
				return $candidate;
			}
		}
		return $template;
	}
);

/**
 * Add a subtle body class to style the landing page uniquely.
 */
add_filter(
	'body_class',
	function ( $classes ) {
		$selected = get_page_template_slug();
		if ( in_array( $selected, [ 'vt-portal-landing.php', 'vt-platform-index.php', 'vt-agency-index.php', 'vt-country-index.php', 'vt-debut-year-index.php', 'vt-role-index.php', 'vt-contact.php' ], true ) ) {
			$classes[] = 'vt-landing';
		}
		return $classes;
	}
);
