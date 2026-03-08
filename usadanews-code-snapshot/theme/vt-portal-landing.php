<?php
/**
 * Template Name: VTuber Portal Landing
 * Template Post Type: page
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$site_name = get_bloginfo( 'name' );
$current_lang = function_exists( 'pll_current_language' ) ? (string) pll_current_language( 'slug' ) : 'zh';
$seo_pack = [
	'zh' => [
		'title' => 'USADA｜多語系 VTuber / 聲優 / 動漫資料索引',
		'desc'  => 'USADA 收錄台灣與全球 VTuber 條目、社群連結、訂閱數與代表內容，支援多語查找並持續更新。',
		'kw'    => 'VTuber,台灣VTuber,虛擬主播,VTuber資料庫,USADA',
	],
	'cn' => [
		'title' => 'USADA｜多语言 VTuber / 声优 / 动漫资料索引',
		'desc'  => 'USADA 收录台湾与全球 VTuber 条目、社群链接、订阅数据与代表内容，支持多语言检索并持续更新。',
		'kw'    => 'VTuber,虚拟主播,VTuber资料库,USADA',
	],
	'ja' => [
		'title' => 'USADA｜多言語VTuber・声優・アニメ情報データベース',
		'desc'  => 'USADAは台湾と世界中のVTuber情報を収録。プロフィール、SNSリンク、登録者指標、関連情報を多言語で検索できます。',
		'kw'    => 'VTuber,バーチャルYouTuber,VTuberデータベース,USADA',
	],
	'en' => [
		'title' => 'USADA | Multilingual VTuber, Voice Actor & Anime Index',
		'desc'  => 'USADA is a multilingual VTuber index with profiles, social links, subscriber metrics, and curated references.',
		'kw'    => 'VTuber database,virtual youtuber,USADA,VTuber profile',
	],
	'ko' => [
		'title' => 'USADA | VTuber · 성우 · 애니메이션 데이터 허브',
		'desc'  => 'USADA는 VTuber 프로필, 소셜 링크, 구독자 지표를 다국어로 정리한 데이터 인덱스입니다.',
		'kw'    => '버튜버,VTuber,USADA,VTuber 데이터베이스',
	],
	'es' => [
		'title' => 'USADA | Índice multilingüe de VTubers, seiyuus y anime',
		'desc'  => 'USADA es un índice de VTubers con perfiles, enlaces sociales y métricas, disponible en varios idiomas.',
		'kw'    => 'VTuber,base de datos VTuber,USADA,Virtual YouTuber',
	],
	'hi' => [
		'title' => 'USADA | बहुभाषी VTuber, Voice Actor और Anime इंडेक्स',
		'desc'  => 'USADA एक बहुभाषी VTuber इंडेक्स है जिसमें प्रोफाइल, सोशल लिंक और सब्सक्राइबर मेट्रिक्स शामिल हैं।',
		'kw'    => 'VTuber,VTuber database,USADA,Virtual YouTuber',
	],
];
$seo = isset( $seo_pack[ $current_lang ] ) ? $seo_pack[ $current_lang ] : $seo_pack['zh'];

function vtportal_landing_cache_key( $name, $lang = '' ) {
	$name = sanitize_key( (string) $name );
	$lang = sanitize_title( (string) $lang );
	if ( '' === $lang ) {
		$lang = 'all';
	}
	// Bump this suffix to invalidate all landing caches after template logic changes.
	$ver = 'v3';
	return 'vtlp_' . $ver . '_' . $name . '_' . $lang;
}

function vtportal_landing_cached( $name, $lang, $ttl, $builder ) {
	$key = vtportal_landing_cache_key( $name, $lang );
	$ttl = max( 60, intval( $ttl ) );
	$val = get_transient( $key );
	if ( false !== $val ) {
		return $val;
	}
	$val = is_callable( $builder ) ? call_user_func( $builder ) : null;
	set_transient( $key, $val, $ttl );
	return $val;
}

function vtportal_landing_eyebrow_copy( $lang = '' ) {
	$lang = sanitize_title( (string) $lang );
	$map = [
		'zh' => '多語系 VTuber / 聲優 / 動漫資料索引',
		'cn' => '多语言 VTuber / 声优 / 动漫资料索引',
		'ja' => '多言語 VTuber / 声優 / アニメ情報ハブ',
		'en' => 'Multilingual VTuber / Voice Actor / Anime Hub',
		'ko' => '다국어 VTuber / 성우 / 애니메이션 허브',
		'es' => 'Hub multilingüe de VTuber / Seiyuu / Anime',
		'hi' => 'बहुभाषी VTuber / Voice Actor / Anime हब',
	];
	return isset( $map[ $lang ] ) ? $map[ $lang ] : $map['zh'];
}

function vtportal_page_url_by_template_for_lang( $template, $lang = '' ) {
	$template = trim( (string) $template );
	$lang = sanitize_title( (string) $lang );
	if ( '' === $template ) {
		return '';
	}
	static $base_page_by_template = [];
	static $url_cache = [];
	$ck = $template . '|' . $lang;
	if ( isset( $url_cache[ $ck ] ) ) {
		return $url_cache[ $ck ];
	}
	if ( ! array_key_exists( $template, $base_page_by_template ) ) {
		$q = new WP_Query(
			[
				'post_type'              => 'page',
				'post_status'            => 'publish',
				'posts_per_page'         => 1,
				'orderby'                => 'ID',
				'order'                  => 'ASC',
				'fields'                 => 'ids',
				'suppress_filters'       => true,
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
				'meta_query'             => [
					[
						'key'   => '_wp_page_template',
						'value' => $template,
					],
				],
			]
		);
		$base_page_by_template[ $template ] = intval( $q->posts[0] ?? 0 );
		wp_reset_postdata();
	}
	$base_id = intval( $base_page_by_template[ $template ] ?? 0 );
	if ( $base_id <= 0 ) {
		$url_cache[ $ck ] = '';
		return $url_cache[ $ck ];
	}
	if ( function_exists( 'pll_get_post_translations' ) && '' !== $lang ) {
		$map = pll_get_post_translations( $base_id );
		$tid = intval( is_array( $map ) ? ( $map[ $lang ] ?? 0 ) : 0 );
		if ( $tid > 0 ) {
			$u = get_permalink( $tid );
			if ( is_string( $u ) && '' !== $u ) {
				$url_cache[ $ck ] = $u;
				return $url_cache[ $ck ];
			}
		}
	}
	$u = get_permalink( $base_id );
	$url_cache[ $ck ] = is_string( $u ) ? $u : '';
	return $url_cache[ $ck ];
}

function vtportal_url_with_lang( $path, $lang = '' ) {
	$path = '/' . ltrim( (string) $path, '/' );
	$lang = sanitize_title( (string) $lang );
	$special_pages = [
		'/platforms/' => 'vt-platform-index.php',
		'/agencies/'  => 'vt-agency-index.php',
		'/countries/' => 'vt-country-index.php',
				'/roles/'       => 'vt-role-index.php',
		'/contact/'   => 'vt-contact.php',
	];
	$path_key = '/' . trim( $path, '/' ) . '/';
	if ( isset( $special_pages[ $path_key ] ) ) {
		$special = vtportal_page_url_by_template_for_lang( $special_pages[ $path_key ], $lang );
		if ( '' !== $special ) {
			return $special;
		}
	}
	if ( '' === $lang || 'zh' === $lang ) {
		return home_url( $path );
	}
	$allowed = [ 'cn', 'ja', 'en', 'ko', 'es', 'hi' ];
	if ( ! in_array( $lang, $allowed, true ) ) {
		return home_url( $path );
	}
	return home_url( '/' . $lang . $path );
}

function vtportal_archive_url_for_lang( $post_type, $lang = '' ) {
	$obj  = get_post_type_object( $post_type );
	$slug = isset( $obj->rewrite['slug'] ) ? (string) $obj->rewrite['slug'] : $post_type;
	return vtportal_url_with_lang( '/' . trim( $slug, '/' ) . '/', $lang );
}

function vtportal_lang_fallback_chain( $lang ) {
	$lang = sanitize_title( (string) $lang );
	$chain = [];
	if ( '' !== $lang ) {
		$chain[] = $lang;
	}
	if ( 'en' !== $lang ) {
		$chain[] = 'en';
	}
	if ( 'zh' !== $lang ) {
		$chain[] = 'zh';
	}
	return array_values( array_unique( array_filter( $chain ) ) );
}

function vtportal_query_with_lang_fallback( $query_args, $lang ) {
	$query_args = is_array( $query_args ) ? $query_args : [];
	$langs = vtportal_lang_fallback_chain( $lang );
	foreach ( $langs as $slug ) {
		$args = $query_args;
		$args['lang'] = $slug;
		$q = new WP_Query( $args );
		if ( $q->have_posts() ) {
			return $q;
		}
		wp_reset_postdata();
	}
	return new WP_Query( $query_args );
}

$count_lang_arg = [];
if ( function_exists( 'pll_current_language' ) && '' !== $current_lang ) {
	// Polylang supports a `lang` query var that scopes queries to the active language.
	$count_lang_arg['lang'] = $current_lang;
}

/**
 * Resolve the best life-status term slug for the current language.
 *
 * Polylang can create translated term slugs (ex: hiatus-zh / hiatus-en),
 * while legacy data may still use base slugs (ex: active, graduated).
 *
 * Strategy:
 * - For zh: try base first, then base-zh.
 * - For other langs: try base-lang first, then base.
 * - Prefer an existing term with non-zero count.
 */
function vtportal_life_term_slug_for_lang( $base_slug, $lang = '' ) {
	$base = sanitize_title( (string) $base_slug );
	$lang = strtolower( trim( (string) $lang ) );

	$candidates = [];
	if ( '' === $lang || 'zh' === $lang ) {
		$candidates = [ $base, $base . '-zh' ];
	} else {
		$allowed = [ 'cn', 'ja', 'en', 'ko', 'es', 'hi' ];
		if ( in_array( $lang, $allowed, true ) ) {
			$candidates = [ $base . '-' . $lang, $base ];
		} else {
			$candidates = [ $base ];
		}
	}

	$best_slug  = $base;
	$best_count = -1;
	foreach ( $candidates as $slug ) {
		$term = get_term_by( 'slug', (string) $slug, 'life-status' );
		if ( ! $term || is_wp_error( $term ) ) {
			continue;
		}
		$cnt = isset( $term->count ) ? intval( $term->count ) : 0;
		if ( $cnt > 0 ) {
			return (string) $slug;
		}
		if ( $cnt > $best_count ) {
			$best_count = $cnt;
			$best_slug  = (string) $slug;
		}
	}

	return $best_slug;
}

$stats_cached = vtportal_landing_cached(
	'stats',
	$current_lang,
	300,
	function () use ( $count_lang_arg, $current_lang ) {
		$core_total_q = new WP_Query(
			array_merge(
				[
					'post_type'      => 'vtuber',
					'post_status'    => 'publish',
					'posts_per_page' => 1,
					'fields'         => 'ids',
				],
				$count_lang_arg
			)
		);
		$core_total = intval( $core_total_q->found_posts );
		wp_reset_postdata();

		$life_counts = [
			'active'       => 0,
			'reincarnated' => 0,
			'graduated'    => 0,
			'hiatus'       => 0,
		];
		$life_slugs = array_keys( $life_counts );
		foreach ( $life_slugs as $slug ) {
			$term_slug = vtportal_life_term_slug_for_lang( $slug, $current_lang );
			$cq = new WP_Query(
				array_merge(
					[
						'post_type'      => 'vtuber',
						'post_status'    => 'publish',
						'posts_per_page' => 1,
						'fields'         => 'ids',
						'tax_query'      => [
							[
								'taxonomy' => 'life-status',
								'field'    => 'slug',
								'terms'    => [ $term_slug ],
							],
						],
					],
					$count_lang_arg
				)
			);
			$life_counts[ $slug ] = intval( $cq->found_posts );
			wp_reset_postdata();
		}

		$life_urls = [
			'active'       => home_url( '/life-status/active/' ),
			'reincarnated' => home_url( '/life-status/reincarnated/' ),
			'graduated'    => home_url( '/life-status/graduated/' ),
			'hiatus'       => home_url( '/life-status/hiatus/' ),
		];
		if ( taxonomy_exists( 'life-status' ) ) {
			foreach ( array_keys( $life_urls ) as $slug ) {
				$term_slug = vtportal_life_term_slug_for_lang( $slug, $current_lang );
				$term = get_term_by( 'slug', $term_slug, 'life-status' );
				if ( $term && ! is_wp_error( $term ) ) {
					$link = get_term_link( $term );
					if ( ! is_wp_error( $link ) ) {
						$life_urls[ $slug ] = $link;
					}
				}
			}
		}

		$updated_7d_q = new WP_Query(
			array_merge(
				[
					'post_type'      => 'vtuber',
					'post_status'    => 'publish',
					'posts_per_page' => 1,
					'fields'         => 'ids',
					'date_query'     => [
						[
							'after'     => gmdate( 'Y-m-d H:i:s', time() - ( 7 * DAY_IN_SECONDS ) ),
							'inclusive' => true,
							'column'    => 'post_modified_gmt',
						],
					],
				],
				$count_lang_arg
			)
		);
		$updated_7d_count = intval( $updated_7d_q->found_posts );
		wp_reset_postdata();

		return [
			'core_total'       => $core_total,
			'life_counts'      => $life_counts,
			'life_urls'        => $life_urls,
			'updated_7d_count' => $updated_7d_count,
		];
	}
);

$core_total       = intval( $stats_cached['core_total'] ?? 0 );
$life_counts      = array_merge(
	[
		'active'       => 0,
		'reincarnated' => 0,
		'graduated'    => 0,
		'hiatus'       => 0,
	],
	is_array( $stats_cached['life_counts'] ?? null ) ? $stats_cached['life_counts'] : []
);
$life_urls        = array_merge(
	[
		'active'       => home_url( '/life-status/active/' ),
		'reincarnated' => home_url( '/life-status/reincarnated/' ),
		'graduated'    => home_url( '/life-status/graduated/' ),
		'hiatus'       => home_url( '/life-status/hiatus/' ),
	],
	is_array( $stats_cached['life_urls'] ?? null ) ? $stats_cached['life_urls'] : []
);
$updated_7d_count = intval( $stats_cached['updated_7d_count'] ?? 0 );
$vt_archive_url   = vtportal_archive_url_for_lang( 'vtuber', $current_lang );

$vt_recent_ids = vtportal_landing_cached(
	'recent_ids',
	$current_lang,
	300,
	function () use ( $current_lang ) {
		$q = vtportal_query_with_lang_fallback(
			[
				'post_type'      => 'vtuber',
				'post_status'    => 'publish',
				'posts_per_page' => 4,
				'orderby'        => 'modified',
				'order'          => 'DESC',
				'no_found_rows'  => true,
				'fields'         => 'ids',
			],
			$current_lang
		);
		$ids = array_values( array_filter( array_map( 'intval', (array) $q->posts ) ) );
		wp_reset_postdata();
		return $ids;
	}
);
$vt_recent = new WP_Query(
	[
		'post_type'              => 'vtuber',
		'post_status'            => 'publish',
		'posts_per_page'         => max( 1, count( (array) $vt_recent_ids ) ),
		'post__in'               => ! empty( $vt_recent_ids ) ? $vt_recent_ids : [ 0 ],
		'orderby'                => 'post__in',
		'ignore_sticky_posts'    => true,
		'no_found_rows'          => true,
		'update_post_meta_cache' => true,
		'update_post_term_cache' => true,
	]
);

$vt_latest_ids = vtportal_landing_cached(
	'featured_ids',
	$current_lang,
	600,
	function () use ( $current_lang ) {
		$q = vtportal_query_with_lang_fallback(
			[
				'post_type'      => 'vtuber',
				'post_status'    => 'publish',
				'posts_per_page' => 8,
				'meta_key'       => 'vt_youtube_subs',
				'orderby'        => 'meta_value_num',
				'order'          => 'DESC',
				'no_found_rows'  => true,
				'fields'         => 'ids',
			],
			$current_lang
		);
		$ids = array_values( array_filter( array_map( 'intval', (array) $q->posts ) ) );
		wp_reset_postdata();
		return $ids;
	}
);
$vt_latest = new WP_Query(
	[
		'post_type'              => 'vtuber',
		'post_status'            => 'publish',
		'posts_per_page'         => max( 1, count( (array) $vt_latest_ids ) ),
		'post__in'               => ! empty( $vt_latest_ids ) ? $vt_latest_ids : [ 0 ],
		'orderby'                => 'post__in',
		'ignore_sticky_posts'    => true,
		'no_found_rows'          => true,
		'update_post_meta_cache' => true,
		'update_post_term_cache' => true,
	]
);

function vtportal_hot_country_slugs_for_lang( $lang ) {
	$lang = sanitize_title( (string) $lang );
	$map = [
		// Traditional Chinese: focus on Taiwan / Hong Kong / Macau.
		'zh' => [ 'tw', 'hk', 'mo' ],
		// Simplified Chinese: focus on Mainland China.
		'cn' => [ 'cn' ],
		// Japanese / Korean language pages.
		'ja' => [ 'jp' ],
		'ko' => [ 'kr' ],
		// English page: prioritize major English-speaking regions.
		'en' => [ 'us', 'gb', 'ca', 'au', 'nz', 'sg', 'ph' ],
		// Spanish / Hindi pages.
		'es' => [ 'es', 'mx', 'ar', 'cl', 'co', 'pe' ],
		'hi' => [ 'in' ],
	];
	return isset( $map[ $lang ] ) ? (array) $map[ $lang ] : [];
}

function vtportal_hot_country_term_ids( $country_codes ) {
	$country_codes = array_values(
		array_unique(
			array_filter(
				array_map(
					function ( $v ) {
						return sanitize_title( (string) $v );
					},
					(array) $country_codes
				)
			)
		)
	);
	if ( empty( $country_codes ) || ! taxonomy_exists( 'country' ) ) {
		return [];
	}

	static $cache = [];
	$key = implode( '|', $country_codes );
	if ( isset( $cache[ $key ] ) ) {
		return $cache[ $key ];
	}

	$terms = get_terms(
		[
			'taxonomy'   => 'country',
			'hide_empty' => false,
			'fields'     => 'all',
		]
	);
	if ( empty( $terms ) || is_wp_error( $terms ) ) {
		$cache[ $key ] = [];
		return [];
	}

	$ids = [];
	foreach ( $terms as $term ) {
		$slug = sanitize_title( (string) ( $term->slug ?? '' ) );
		if ( '' === $slug ) {
			continue;
		}
		foreach ( $country_codes as $code ) {
			if ( $slug === $code || 0 === strpos( $slug, $code . '-' ) ) {
				$ids[ intval( $term->term_id ) ] = intval( $term->term_id );
				break;
			}
		}
	}

	$cache[ $key ] = array_values( $ids );
	return $cache[ $key ];
}

function vtportal_hot_section_copy_for_lang( $lang ) {
	$lang = sanitize_title( (string) $lang );
	$copy = [
		'zh' => [ 'title' => '繁中熱門 VTuber（台港澳）', 'desc' => '依人氣指標排序（YouTube + Twitch）' ],
		'cn' => [ 'title' => '简中热门 VTuber（中国）', 'desc' => '按热度指标排序（YouTube + Twitch）' ],
		'ja' => [ 'title' => '日本語人気 VTuber（日本）', 'desc' => '人気指標で並び替え（YouTube + Twitch）' ],
		'en' => [ 'title' => 'Top VTubers (English Region)', 'desc' => 'Ranked by popularity signal (YouTube + Twitch)' ],
		'ko' => [ 'title' => '한국어권 인기 VTuber', 'desc' => '인기 지표 기준 정렬 (YouTube + Twitch)' ],
		'es' => [ 'title' => 'VTubers populares (región en español)', 'desc' => 'Ordenado por popularidad (YouTube + Twitch)' ],
		'hi' => [ 'title' => 'हिंदी क्षेत्र के लोकप्रिय VTubers', 'desc' => 'लोकप्रियता संकेत के अनुसार क्रम (YouTube + Twitch)' ],
	];
	return isset( $copy[ $lang ] ) ? $copy[ $lang ] : [ 'title' => '語系熱門 VTuber', 'desc' => '依人氣指標排序（YouTube + Twitch）' ];
}

function vtportal_collect_lang_hot_vtubers( $lang, $limit = 8 ) {
	$lang   = sanitize_title( (string) $lang );
	$limit  = max( 4, min( 16, intval( $limit ) ) );
	$codes  = vtportal_hot_country_slugs_for_lang( $lang );
	$terms  = vtportal_hot_country_term_ids( $codes );
	$scope  = ! empty( $terms );

	$ids = [];
	$lang_candidates = function_exists( 'vtportal_lang_fallback_chain' ) ? vtportal_lang_fallback_chain( $lang ) : [ $lang ];
	if ( empty( $lang_candidates ) ) {
		$lang_candidates = [ $lang ];
	}

	// 1) Country-scoped metric sort.
	foreach ( $lang_candidates as $lang_slug ) {
		$lang_arg = [];
		if ( function_exists( 'pll_current_language' ) && '' !== $lang_slug ) {
			$lang_arg['lang'] = $lang_slug;
		}
		$base = array_merge(
			[
				'post_type'              => 'vtuber',
				'post_status'            => 'publish',
				'posts_per_page'         => 60,
				'no_found_rows'  => true,
				'fields'         => 'ids',
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			],
			$lang_arg
		);
		if ( $scope ) {
			$base['tax_query'] = [
				[
					'taxonomy' => 'country',
					'field'    => 'term_id',
					'terms'    => $terms,
					'operator' => 'IN',
				],
			];
		}
		foreach ( [ 'vt_youtube_subs', 'vt_twitch_followers' ] as $meta_key ) {
			$q = new WP_Query(
				array_merge(
					$base,
					[
						'meta_key' => $meta_key,
						'orderby'  => 'meta_value_num',
						'order'    => 'DESC',
					]
				)
			);
			foreach ( (array) $q->posts as $pid ) {
				$ids[ intval( $pid ) ] = true;
			}
			wp_reset_postdata();
		}
		if ( count( $ids ) >= ( $limit * 4 ) ) {
			break;
		}
	}

	// 2) Keep region intent by filling with latest country-scoped records.
	if ( count( $ids ) < $limit ) {
		foreach ( $lang_candidates as $lang_slug ) {
			$lang_arg = [];
			if ( function_exists( 'pll_current_language' ) && '' !== $lang_slug ) {
				$lang_arg['lang'] = $lang_slug;
			}
			$fallback_args = array_merge(
				[
					'post_type'              => 'vtuber',
					'post_status'            => 'publish',
					'posts_per_page'         => 100,
					'no_found_rows'          => true,
					'fields'                 => 'ids',
					'orderby'                => 'modified',
					'order'                  => 'DESC',
					'update_post_meta_cache' => false,
					'update_post_term_cache' => false,
				],
				$lang_arg
			);
			if ( $scope ) {
				$fallback_args['tax_query'] = [
					[
						'taxonomy' => 'country',
						'field'    => 'term_id',
						'terms'    => $terms,
						'operator' => 'IN',
					],
				];
			}
			$fallback_q = new WP_Query( $fallback_args );
			foreach ( (array) $fallback_q->posts as $pid ) {
				$ids[ intval( $pid ) ] = true;
			}
			wp_reset_postdata();
			if ( count( $ids ) >= $limit ) {
				break;
			}
		}
	}

	// 3) Only use global fallback when there is no country mapping, or scoped results are totally empty.
	if ( count( $ids ) < $limit && ( ! $scope || empty( $ids ) ) ) {
		foreach ( $lang_candidates as $lang_slug ) {
			$lang_arg = [];
			if ( function_exists( 'pll_current_language' ) && '' !== $lang_slug ) {
				$lang_arg['lang'] = $lang_slug;
			}
			$plain_q = new WP_Query(
				array_merge(
					[
						'post_type'              => 'vtuber',
						'post_status'            => 'publish',
						'posts_per_page'         => 120,
						'no_found_rows'          => true,
						'fields'                 => 'ids',
						'meta_key'               => 'vt_youtube_subs',
						'orderby'                => 'meta_value_num',
						'order'                  => 'DESC',
						'update_post_meta_cache' => false,
						'update_post_term_cache' => false,
					],
					$lang_arg
				)
			);
			foreach ( (array) $plain_q->posts as $pid ) {
				$ids[ intval( $pid ) ] = true;
			}
			wp_reset_postdata();
			if ( count( $ids ) >= $limit ) {
				break;
			}
		}
	}

	$rows = [];
	foreach ( array_keys( $ids ) as $pid ) {
		$pid = intval( $pid );
		if ( $pid <= 0 ) {
			continue;
		}
		$yt = intval( get_post_meta( $pid, 'vt_youtube_subs', true ) );
		$tw = intval( get_post_meta( $pid, 'vt_twitch_followers', true ) );
		$score = max( 0, $yt ) + max( 0, $tw );
		$rows[] = [
			'id'    => $pid,
			'yt'    => $yt,
			'tw'    => $tw,
			'score' => $score,
		];
	}

	usort(
		$rows,
		function ( $a, $b ) {
			$as = intval( $a['score'] ?? 0 );
			$bs = intval( $b['score'] ?? 0 );
			if ( $as !== $bs ) {
				return $bs <=> $as;
			}
			$ay = intval( $a['yt'] ?? 0 );
			$by = intval( $b['yt'] ?? 0 );
			if ( $ay !== $by ) {
				return $by <=> $ay;
			}
			return intval( $b['tw'] ?? 0 ) <=> intval( $a['tw'] ?? 0 );
		}
	);

	return array_slice( $rows, 0, $limit );
}

function vtportal_display_name( $post_id ) {
	$b64 = get_post_meta( $post_id, 'vt_display_b64', true );
	if ( $b64 ) {
		$decoded = base64_decode( $b64, true );
		if ( $decoded ) {
			return $decoded;
		}
	}
	return get_the_title( $post_id );
}

function vtportal_filter_terms( $terms ) {
	if ( empty( $terms ) || is_wp_error( $terms ) ) {
		return [];
	}
	$out = [];
	foreach ( $terms as $term ) {
		$tax  = isset( $term->taxonomy ) ? (string) $term->taxonomy : '';
		$slug = isset( $term->slug ) ? (string) $term->slug : '';
		// Never treat Indie/個人勢 as an organization (legacy data may include indie-zh etc).
		if ( 'agency' === $tax && preg_match( '/^indie(?:-[a-z]{2,3})?$/i', $slug ) ) {
			continue;
		}
		$name = trim( $term->name );
		if ( 'agency' === $tax && preg_match( '/^(indie|independent|solo|個人勢|個人)$/iu', $name ) ) {
			continue;
		}
		// Keep life-status only in the `life-status` taxonomy (avoid showing status-like role tags).
		if ( 'role-tag' === $tax && preg_match( '/(活動中|休止|暫停|畢業|卒業|引退|封存|archiv|hiatus|graduat|active)/iu', $name ) ) {
			continue;
		}
		if ( strlen( $name ) < 2 ) {
			continue;
		}
		if ( false !== strpos( $name, '??' ) ) {
			continue;
		}
		if ( isset( $term->taxonomy ) && 'role-tag' === (string) $term->taxonomy && preg_match( '/(轉生|转生|reincarn)/iu', $name ) ) {
			continue;
		}
		$out[] = $term;
	}
	return $out;
}

function vtportal_lifecycle_label( $post_id ) {
	$terms = get_the_terms( $post_id, 'life-status' );
	$slug  = 'active';
	if ( ! empty( $terms ) && ! is_wp_error( $terms ) ) {
		$t = reset( $terms );
		if ( $t && ! empty( $t->slug ) ) {
			$slug = (string) $t->slug;
		}
		// Prefer term name if available (supports Polylang translated terms like "Hiatus").
		if ( $t && ! empty( $t->name ) ) {
			return (string) $t->name;
		}
	} else {
		$m = (string) get_post_meta( $post_id, 'vt_lifecycle_status', true );
		if ( '' !== trim( $m ) ) {
			$slug = sanitize_title( $m );
		}
	}
	// Normalize slugs like "hiatus-zh" -> "hiatus".
	if ( preg_match( '/^(active|graduated|reincarnated|hiatus)(?:-[a-z]{2,3})?$/i', sanitize_title( $slug ), $m2 ) ) {
		$slug = strtolower( (string) $m2[1] );
	}
	$labels = [
		'active'       => __( '活動中', 'vtuber-portal' ),
		'graduated'    => __( '已畢業 / 引退', 'vtuber-portal' ),
		'reincarnated' => __( '轉生 / 前世', 'vtuber-portal' ),
		'hiatus'       => __( '休止中', 'vtuber-portal' ),
	];
	return $labels[ $slug ] ?? $labels['active'];
}

function vtportal_collect_popular_tags( $limit = 14 ) {
	$limit = max( 6, min( 30, intval( $limit ) ) );
	$taxes = [ 'life-status', 'country', 'debut-year', 'platform', 'agency', 'role-tag' ];
	$list  = [];

	foreach ( $taxes as $tax ) {
		if ( ! taxonomy_exists( $tax ) ) {
			continue;
		}
		$terms = get_terms(
			[
				'taxonomy'   => $tax,
				'hide_empty' => true,
				'orderby'    => 'count',
				'order'      => 'DESC',
				'number'     => 12,
			]
		);
		if ( empty( $terms ) || is_wp_error( $terms ) ) {
			continue;
		}
		foreach ( $terms as $term ) {
			$name = trim( (string) $term->name );
			if ( strlen( $name ) < 2 || false !== strpos( $name, '??' ) ) {
				continue;
			}
			// Hide reincarnation-oriented role tags from homepage cloud (privacy/UX).
			if ( 'role-tag' === $tax && preg_match( '/(轉生|转生|reincarn)/iu', $name ) ) {
				continue;
			}
			$link = get_term_link( $term );
			if ( is_wp_error( $link ) ) {
				continue;
			}
			$key = $tax . ':' . intval( $term->term_id );
			$list[ $key ] = [
				'name'     => $name,
				'link'     => (string) $link,
				'count'    => intval( $term->count ),
				'taxonomy' => $tax,
			];
		}
	}

	if ( empty( $list ) ) {
		return [];
	}

	usort(
		$list,
		function ( $a, $b ) {
			return intval( $b['count'] ) <=> intval( $a['count'] );
		}
	);

	return array_slice( array_values( $list ), 0, $limit );
}

$popular_tags = vtportal_landing_cached(
	'popular_tags',
	$current_lang,
	600,
	function () {
		return vtportal_collect_popular_tags( 14 );
	}
);
if ( empty( $popular_tags ) ) {
	$fallback_links = [
		[
			'name'     => __( '活動中', 'vtuber-portal' ),
			'link'     => $life_urls['active'],
			'count'    => $life_counts['active'],
			'taxonomy' => 'life-status',
		],
		[
			'name'     => __( '7日更新', 'vtuber-portal' ),
			'link'     => $vt_archive_url,
			'count'    => $updated_7d_count,
			'taxonomy' => 'life-status',
		],
		[
			'name'     => __( '畢業 / 引退', 'vtuber-portal' ),
			'link'     => $life_urls['graduated'],
			'count'    => $life_counts['graduated'],
			'taxonomy' => 'life-status',
		],
		[
			'name'     => __( '休止中', 'vtuber-portal' ),
			'link'     => $life_urls['hiatus'],
			'count'    => $life_counts['hiatus'],
			'taxonomy' => 'life-status',
		],
		[
			'name'     => __( 'YouTube', 'vtuber-portal' ),
			'link'     => vtportal_url_with_lang( '/platform/youtube/', $current_lang ),
			'count'    => 0,
			'taxonomy' => 'platform',
		],
		[
			'name'     => __( 'Twitch', 'vtuber-portal' ),
			'link'     => vtportal_url_with_lang( '/platform/twitch/', $current_lang ),
			'count'    => 0,
			'taxonomy' => 'platform',
		],
	];
	$popular_tags = $fallback_links;
}
$popular_tax_labels = [
	'life-status' => __( '狀態', 'vtuber-portal' ),
	'country'     => __( '國家/地區', 'vtuber-portal' ),
	'debut-year'  => __( '出道年', 'vtuber-portal' ),
	'platform'    => __( '平台', 'vtuber-portal' ),
	'agency'      => __( '組織', 'vtuber-portal' ),
	'role-tag'    => __( '標籤', 'vtuber-portal' ),
];
$popular_counts = array_values(
	array_filter(
		array_map(
			function ( $i ) {
				return intval( $i['count'] ?? 0 );
			},
			(array) $popular_tags
		),
		function ( $v ) {
			return $v > 0;
		}
	)
);
$tag_min = ! empty( $popular_counts ) ? min( $popular_counts ) : 1;
$tag_max = ! empty( $popular_counts ) ? max( $popular_counts ) : 1;
foreach ( $popular_tags as &$tag ) {
	$c = intval( $tag['count'] ?? 0 );
	if ( $tag_max <= $tag_min ) {
		$w = 3;
	} else {
		$ratio = ( $c - $tag_min ) / ( $tag_max - $tag_min );
		$w = 1 + (int) round( $ratio * 4 );
	}
	$tag['weight'] = max( 1, min( 5, $w ) );
}
unset( $tag );

$vt_lang_hot_copy  = vtportal_hot_section_copy_for_lang( $current_lang );
$vt_lang_hot_items = vtportal_landing_cached(
	'lang_hot',
	$current_lang,
	600,
	function () use ( $current_lang ) {
		return vtportal_collect_lang_hot_vtubers( $current_lang, 8 );
	}
);
$has_anime_content = function_exists( 'vtportal_has_public_content' ) ? vtportal_has_public_content( 'anime-work', $current_lang ) : true;
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width,initial-scale=1">
	<?php if ( ! defined( 'WPSEO_VERSION' ) ) : ?>
		<?php if ( ! function_exists( 'current_theme_supports' ) || ! current_theme_supports( 'title-tag' ) ) : ?>
			<title><?php echo esc_html( $seo['title'] ); ?></title>
		<?php endif; ?>
		<meta name="description" content="<?php echo esc_attr( $seo['desc'] ); ?>">
	<?php endif; ?>
	<?php
	if ( function_exists( 'vtportal_render_polylang_seo_links_for_post' ) ) {
		vtportal_render_polylang_seo_links_for_post( intval( get_queried_object_id() ) );
	}
	?>
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'vt-landing vt-landing-bare' ); ?>>
<!-- vt-landing-custom-template -->
<main class="vt-landing-wrap">
	<div class="vt-top-bar">
		<div class="vt-pill-nav">
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/', $current_lang ) ); ?>"><?php esc_html_e( '首頁', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'vtuber', $current_lang ) ); ?>"><?php esc_html_e( 'VTuber 列表', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/roles/', $current_lang ) ); ?>"><?php esc_html_e( '依風格', 'vtuber-portal' ); ?></a>
			<?php if ( $has_anime_content ) : ?>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'anime-work', $current_lang ) ); ?>"><?php esc_html_e( '作品資料庫', 'vtuber-portal' ); ?></a>
			<?php endif; ?>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'character', $current_lang ) ); ?>"><?php esc_html_e( '角色資料庫', 'vtuber-portal' ); ?></a>
		</div>
		<div class="vt-lang-wrap vt-lang-float">
			<span class="vt-lang-label"><?php esc_html_e( '語言', 'vtuber-portal' ); ?></span>
			<?php if ( function_exists( 'vtportal_render_language_dropdown' ) ) : ?>
				<?php vtportal_render_language_dropdown(); ?>
			<?php elseif ( function_exists( 'pll_the_languages' ) ) : ?>
				<div class="pll-switcher"><?php pll_the_languages( [ 'dropdown' => 1, 'show_flags' => 1, 'display_names_as' => 'name' ] ); ?></div>
			<?php endif; ?>
		</div>
	</div>
	<section class="vt-hero-neo">
		<span class="orb orb1"></span>
		<span class="orb orb2"></span>
		<div class="vt-hero-copy">
			<p class="vt-eyebrow"><?php echo esc_html( sprintf( '%s · %s', $site_name, vtportal_landing_eyebrow_copy( $current_lang ) ) ); ?></p>
			<h1><?php echo esc_html( $seo['title'] ); ?></h1>
			<p class="lede"><?php echo esc_html( $seo['desc'] ); ?></p>
			<div class="vt-hero-actions">
				<a class="vt-btn primary" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'vtuber', $current_lang ) ); ?>"><?php esc_html_e( '瀏覽 VTuber', 'vtuber-portal' ); ?></a>
				<?php if ( $has_anime_content ) : ?>
				<a class="vt-btn ghost" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'anime-work', $current_lang ) ); ?>"><?php esc_html_e( '作品資料庫', 'vtuber-portal' ); ?></a>
				<?php endif; ?>
			</div>
			<div class="vt-hero-meta">
				<a class="item" href="<?php echo esc_url( $vt_archive_url ); ?>"><div class="label"><?php esc_html_e( 'VTubers', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( number_format_i18n( $core_total ) ); ?></div></a>
				<a class="item" href="<?php echo esc_url( $life_urls['active'] ); ?>"><div class="label"><?php esc_html_e( '活動中', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( number_format_i18n( $life_counts['active'] ) ); ?></div></a>
				<a class="item" href="<?php echo esc_url( $life_urls['reincarnated'] ); ?>"><div class="label"><?php esc_html_e( '轉生 / 前世', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( number_format_i18n( $life_counts['reincarnated'] ) ); ?></div></a>
				<a class="item" href="<?php echo esc_url( $life_urls['graduated'] ); ?>"><div class="label"><?php esc_html_e( '畢業 / 引退', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( number_format_i18n( $life_counts['graduated'] ) ); ?></div></a>
				<a class="item" href="<?php echo esc_url( $life_urls['hiatus'] ); ?>"><div class="label"><?php esc_html_e( '休止中', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( number_format_i18n( $life_counts['hiatus'] ) ); ?></div></a>
			</div>
			<div class="vt-search-wrap">
				<label for="vt-search-input"><?php esc_html_e( '搜尋 VTuber', 'vtuber-portal' ); ?></label>
				<div class="vt-search-box">
					<input id="vt-search-input" type="search" placeholder="<?php esc_attr_e( '輸入關鍵字搜尋…', 'vtuber-portal' ); ?>" autocomplete="off" />
					<div class="vt-search-results" id="vt-search-results" hidden></div>
				</div>
				<p class="vt-search-hint"><?php esc_html_e( '即時比對並顯示相關結果（依關鍵字匹配）', 'vtuber-portal' ); ?></p>
			</div>
			<?php
			$gsc_hot = get_option( 'vt_gsc_top_queries' );
			if ( is_array( $gsc_hot ) ) {
				$gsc_hot = array_values( array_filter( $gsc_hot, function ( $r ) { return is_array( $r ) && ! empty( $r['query'] ); } ) );
			} else {
				$gsc_hot = [];
			}
			?>
			<?php if ( ! empty( $gsc_hot ) ) : ?>
			<div class="vt-hot-tags vt-hot-gsc" aria-label="<?php esc_attr_e( '近期熱門搜尋', 'vtuber-portal' ); ?>">
				<div class="vt-hot-tags-head">
					<span class="vt-hot-title"><?php esc_html_e( '近期熱門搜尋', 'vtuber-portal' ); ?></span>
				</div>
				<div class="vt-hot-list">
					<?php foreach ( array_slice( $gsc_hot, 0, 28 ) as $r ) : ?>
						<?php
						$q = trim( (string) ( $r['query'] ?? '' ) );
						$url = trim( (string) ( $r['page'] ?? '' ) );
						if ( '' === $q ) {
							continue;
						}
						// Safety net: hide known noisy GSC queries even if stale data exists in option cache.
						if ( function_exists( 'vt_maint_is_noise_gsc_query' ) && vt_maint_is_noise_gsc_query( $q ) ) {
							continue;
						}
						if ( preg_match( '/^(?:youtube|youtuber|yt)\s*[-_:#]?\s*\d{4,}$/iu', $q ) ) {
							continue;
						}
						if ( '' === $url ) {
							$url = vtportal_archive_url_for_lang( 'vtuber', $current_lang );
						}
						?>
						<a class="vt-hot-chip w2" href="<?php echo esc_url( $url ); ?>" title="<?php echo esc_attr( $q ); ?>">
							<span class="name"><?php echo esc_html( $q ); ?></span>
						</a>
					<?php endforeach; ?>
				</div>
			</div>
			<?php endif; ?>
			<?php if ( ! empty( $popular_tags ) ) : ?>
			<div class="vt-hot-tags" aria-label="<?php esc_attr_e( '常用標籤', 'vtuber-portal' ); ?>">
				<div class="vt-hot-tags-head">
					<span class="vt-hot-title"><?php esc_html_e( '常用標籤', 'vtuber-portal' ); ?></span>
					<a class="vt-hot-more" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'vtuber', $current_lang ) ); ?>"><?php esc_html_e( '瀏覽全部', 'vtuber-portal' ); ?></a>
				</div>
				<div class="vt-hot-list">
					<?php foreach ( $popular_tags as $tag ) : ?>
						<?php
						$tax = (string) ( $tag['taxonomy'] ?? '' );
						$tax_label = isset( $popular_tax_labels[ $tax ] ) ? $popular_tax_labels[ $tax ] : __( '分類', 'vtuber-portal' );
						$count_val = intval( $tag['count'] ?? 0 );
						$weight = intval( $tag['weight'] ?? 3 );
						?>
						<a class="vt-hot-chip w<?php echo esc_attr( $weight ); ?>" href="<?php echo esc_url( $tag['link'] ); ?>" title="<?php echo esc_attr( $tax_label ); ?>">
							<span class="name"><?php echo esc_html( $tag['name'] ); ?></span>
						</a>
					<?php endforeach; ?>
				</div>
			</div>
			<?php endif; ?>
		</div>
		<div class="vt-hero-grid">
			<div class="vt-recent-head">
				<div class="vt-recent-label"><?php esc_html_e( '最新更新', 'vtuber-portal' ); ?></div>
				<div class="vt-recent-sub"><?php esc_html_e( '依更新時間排序（最新優先）', 'vtuber-portal' ); ?></div>
			</div>
			<?php if ( $vt_recent->have_posts() ) :
				while ( $vt_recent->have_posts() ) :
					$vt_recent->the_post();
					?>
					<article class="vt-hero-mini vt-recent">
						<a href="<?php the_permalink(); ?>" class="vt-card-block">
							<?php
							$thumb = get_post_meta( get_the_ID(), 'vt_thumb_url', true );
							if ( empty( $thumb ) ) {
								$thumb = get_post_meta( get_the_ID(), 'vt_thumb_source_url', true );
							}
							if ( has_post_thumbnail() ) {
								the_post_thumbnail( 'medium', [ 'alt' => esc_attr( vtportal_display_name( get_the_ID() ) ) ] );
							} elseif ( $thumb ) {
								echo '<img class="vt-thumb-ph" src="' . esc_url( $thumb ) . '" alt="' . esc_attr( vtportal_display_name( get_the_ID() ) ) . '" />';
							} else {
								echo '<img class="vt-thumb-ph" src="' . esc_url( VT_PORTAL_URL . 'assets/vt-placeholder.png' ) . '" alt="' . esc_attr( vtportal_display_name( get_the_ID() ) ) . '" />';
							}
							?>
							<div class="vt-mini-main">
								<div class="type"><?php esc_html_e( 'VTuber', 'vtuber-portal' ); ?> · <?php echo esc_html( get_the_modified_time( 'Y/m/d H:i' ) ); ?></div>
								<h3 class="title" style="color:#f8fafc; text-decoration:none;"><?php echo esc_html( vtportal_display_name( get_the_ID() ) ); ?></h3>
								<div class="type"><?php echo esc_html( vtportal_lifecycle_label( get_the_ID() ) ); ?></div>
							</div>
							<?php
							$recent_desc = trim( wp_strip_all_tags( get_the_excerpt() ) );
							if ( '' === $recent_desc ) {
								$recent_desc = trim( wp_strip_all_tags( (string) get_post_meta( get_the_ID(), 'vt_summary', true ) ) );
							}
							if ( '' === $recent_desc ) {
								$recent_desc = trim( wp_strip_all_tags( vtportal_lifecycle_label( get_the_ID() ) ) );
							}
							if ( '' === $recent_desc ) {
								$recent_desc = __( '資料更新中', 'vtuber-portal' );
							}
							if ( function_exists( 'vtportal_localize_snippet_text' ) ) {
								$recent_desc = vtportal_localize_snippet_text( $recent_desc, $current_lang );
							}
							?>
							<div class="vt-mini-desc"><?php echo esc_html( wp_trim_words( $recent_desc, 36 ) ); ?></div>
						</a>
					</article>
				<?php endwhile; wp_reset_postdata(); endif; ?>
		</div>
	</section>

	<?php if ( function_exists( 'vt_news_render_related' ) ) : ?>
	<section class="vt-section-neo">
		<?php vt_news_render_related( __( 'VTuber 新聞', 'vtuber-portal' ), 6, __( '最新 VTuber 新聞（外部連結）', 'vtuber-portal' ) ); ?>
	</section>
	<?php endif; ?>

	<?php if ( ! empty( $vt_lang_hot_items ) ) : ?>
	<section class="vt-section-neo">
		<h2><?php echo esc_html( $vt_lang_hot_copy['title'] ); ?></h2>
		<p><?php echo esc_html( $vt_lang_hot_copy['desc'] ); ?></p>
		<div class="vt-card-grid neo">
			<?php foreach ( $vt_lang_hot_items as $row ) : ?>
				<?php
				$pid = intval( $row['id'] ?? 0 );
				if ( $pid <= 0 ) {
					continue;
				}
				$thumb = get_post_meta( $pid, 'vt_thumb_url', true );
				if ( empty( $thumb ) ) {
					$thumb = get_post_meta( $pid, 'vt_thumb_source_url', true );
				}
				$yt    = intval( $row['yt'] ?? 0 );
				$tw    = intval( $row['tw'] ?? 0 );
				?>
				<article class="vt-card">
					<a class="vt-card-overlay-link" href="<?php echo esc_url( get_permalink( $pid ) ); ?>" aria-label="<?php echo esc_attr( vtportal_display_name( $pid ) ); ?>"></a>
					<?php if ( has_post_thumbnail( $pid ) ) : ?>
						<a class="vt-card-thumb-wrap" href="<?php echo esc_url( get_permalink( $pid ) ); ?>"><?php echo get_the_post_thumbnail( $pid, 'medium', [ 'class' => 'vt-card-thumb', 'alt' => esc_attr( vtportal_display_name( $pid ) ) ] ); ?></a>
					<?php elseif ( $thumb ) : ?>
						<a class="vt-card-thumb-wrap" href="<?php echo esc_url( get_permalink( $pid ) ); ?>"><img class="vt-card-thumb" src="<?php echo esc_url( $thumb ); ?>" alt="<?php echo esc_attr( vtportal_display_name( $pid ) ); ?>" /></a>
					<?php else : ?>
						<a class="vt-card-thumb-wrap" href="<?php echo esc_url( get_permalink( $pid ) ); ?>"><img class="vt-card-thumb" src="<?php echo esc_url( VT_PORTAL_URL . 'assets/vt-placeholder.png' ); ?>" alt="<?php echo esc_attr( vtportal_display_name( $pid ) ); ?>" /></a>
					<?php endif; ?>
					<div class="vt-card-body">
						<h3 class="vt-card-title"><a href="<?php echo esc_url( get_permalink( $pid ) ); ?>"><?php echo esc_html( vtportal_display_name( $pid ) ); ?></a></h3>
						<p class="vt-card-status"><?php echo esc_html( vtportal_lifecycle_label( $pid ) ); ?></p>
						<?php
						$card_excerpt_raw = (string) get_post_field( 'post_excerpt', $pid );
						if ( function_exists( 'vtportal_localize_snippet_text' ) ) {
							$card_excerpt_raw = vtportal_localize_snippet_text( $card_excerpt_raw, $current_lang );
						}
						?>
						<p class="vt-card-excerpt"><?php echo esc_html( wp_trim_words( $card_excerpt_raw, 18 ) ); ?></p>
						<div class="vt-tax-list">
							<?php if ( $yt > 0 ) : ?><span class="pill"><?php echo esc_html( 'YouTube ' . number_format_i18n( $yt ) ); ?></span><?php endif; ?>
							<?php if ( $tw > 0 ) : ?><span class="pill"><?php echo esc_html( 'Twitch ' . number_format_i18n( $tw ) ); ?></span><?php endif; ?>
						</div>
					</div>
				</article>
			<?php endforeach; ?>
		</div>
	</section>
	<?php endif; ?>

	<section class="vt-section-neo">
		<h2><?php esc_html_e( 'VTuber 精選', 'vtuber-portal' ); ?></h2>
		<p><?php esc_html_e( '收錄出道、粉絲名、代表影片等欄位，方便快速查找。', 'vtuber-portal' ); ?></p>
		<div class="vt-card-grid neo">
			<?php if ( $vt_latest->have_posts() ) : while ( $vt_latest->have_posts() ) : $vt_latest->the_post(); ?>
				<article class="vt-card">
					<a class="vt-card-overlay-link" href="<?php the_permalink(); ?>" aria-label="<?php echo esc_attr( vtportal_display_name( get_the_ID() ) ); ?>"></a>
					<?php
					$thumb = get_post_meta( get_the_ID(), 'vt_thumb_url', true );
					if ( empty( $thumb ) ) {
						$thumb = get_post_meta( get_the_ID(), 'vt_thumb_source_url', true );
					}
					if ( has_post_thumbnail() ) :
						?>
						<a class="vt-card-thumb-wrap" href="<?php the_permalink(); ?>"><?php the_post_thumbnail( 'medium', [ 'class' => 'vt-card-thumb', 'alt' => esc_attr( vtportal_display_name( get_the_ID() ) ) ] ); ?></a>
					<?php elseif ( $thumb ) : ?>
						<a class="vt-card-thumb-wrap" href="<?php the_permalink(); ?>"><img class="vt-card-thumb" src="<?php echo esc_url( $thumb ); ?>" alt="<?php echo esc_attr( vtportal_display_name( get_the_ID() ) ); ?>" /></a>
					<?php else : ?>
						<a class="vt-card-thumb-wrap" href="<?php the_permalink(); ?>"><img class="vt-card-thumb" src="<?php echo esc_url( VT_PORTAL_URL . 'assets/vt-placeholder.png' ); ?>" alt="<?php echo esc_attr( vtportal_display_name( get_the_ID() ) ); ?>" /></a>
					<?php endif; ?>
					<div class="vt-card-body">
						<h3 class="vt-card-title"><a href="<?php the_permalink(); ?>"><?php echo esc_html( vtportal_display_name( get_the_ID() ) ); ?></a></h3>
						<p class="vt-card-status"><?php echo esc_html( vtportal_lifecycle_label( get_the_ID() ) ); ?></p>
						<?php
						$latest_excerpt_raw = (string) get_the_excerpt();
						if ( function_exists( 'vtportal_localize_snippet_text' ) ) {
							$latest_excerpt_raw = vtportal_localize_snippet_text( $latest_excerpt_raw, $current_lang );
						}
						?>
						<p class="vt-card-excerpt"><?php echo esc_html( wp_trim_words( $latest_excerpt_raw, 18 ) ); ?></p>
						<div class="vt-tax-list">
							<?php
							$agencies = vtportal_filter_terms( get_the_terms( get_the_ID(), 'agency' ) );
							$platforms = vtportal_filter_terms( get_the_terms( get_the_ID(), 'platform' ) );
							$countries = vtportal_filter_terms( get_the_terms( get_the_ID(), 'country' ) );
							$roles     = vtportal_filter_terms( get_the_terms( get_the_ID(), 'role-tag' ) );

							// Show a small, consistent set of chips (avoid a noisy wall of tags on cards).
							$shown = 0;
							foreach ( [ $countries, $agencies, $platforms, $roles ] as $list ) {
								if ( empty( $list ) ) {
									continue;
								}
								foreach ( $list as $term ) {
									$t_link = get_term_link( $term );
									if ( ! is_wp_error( $t_link ) ) {
										echo '<a class="pill pill-link" href="' . esc_url( $t_link ) . '">' . esc_html( $term->name ) . '</a>';
									} else {
										echo '<span class="pill">' . esc_html( $term->name ) . '</span>';
									}
									$shown++;
									if ( $shown >= 3 ) {
										break 2;
									}
								}
							}
							?>
						</div>
					</div>
				</article>
			<?php endwhile; wp_reset_postdata(); endif; ?>
		</div>
		<div class="vt-pill-nav">
			<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'vtuber', $current_lang ) ); ?>"><?php esc_html_e( '全部 VTuber', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/platforms/', $current_lang ) ); ?>"><?php esc_html_e( '依平台', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/agencies/', $current_lang ) ); ?>"><?php esc_html_e( '依組織', 'vtuber-portal' ); ?></a>
			<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/roles/', $current_lang ) ); ?>"><?php esc_html_e( '依風格', 'vtuber-portal' ); ?></a>
		</div>
	</section>
	<section class="vt-section-neo">
		<h2><?php esc_html_e( '提交建議', 'vtuber-portal' ); ?></h2>
		<p><?php esc_html_e( '想補充新 VTuber 或修正資料？可在此提交，我們會在後台審核後更新。', 'vtuber-portal' ); ?></p>
		<?php if ( isset( $_GET['vt_suggest'] ) && 'ok' === $_GET['vt_suggest'] ) : ?>
			<p class="vt-suggest-ok"><?php esc_html_e( '已收到建議，感謝提交。', 'vtuber-portal' ); ?></p>
		<?php endif; ?>
		<form class="vt-suggest-form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="vt_submit_suggestion" />
			<?php wp_nonce_field( 'vt_suggestion_submit', 'vt_suggestion_nonce' ); ?>
			<div class="vt-suggest-grid">
				<label>
					<span><?php esc_html_e( '名稱', 'vtuber-portal' ); ?></span>
					<input type="text" name="suggest_name" required />
				</label>
				<label>
					<span><?php esc_html_e( '平台', 'vtuber-portal' ); ?></span>
					<input type="text" name="suggest_platform" placeholder="YouTube / Twitch / X" />
				</label>
				<label class="full">
					<span><?php esc_html_e( '連結', 'vtuber-portal' ); ?></span>
					<input type="url" name="suggest_url" placeholder="https://..." />
				</label>
				<label class="full">
					<span><?php esc_html_e( '說明', 'vtuber-portal' ); ?></span>
					<textarea name="suggest_note" rows="4" placeholder="<?php esc_attr_e( '例如：補充出道日期、社群連結或狀態資訊', 'vtuber-portal' ); ?>"></textarea>
				</label>
				<label class="full">
					<span><?php esc_html_e( '聯絡方式（選填）', 'vtuber-portal' ); ?></span>
					<input type="text" name="suggest_contact" placeholder="Email / X / Discord" />
				</label>
			</div>
			<button type="submit" class="vt-btn primary"><?php esc_html_e( '送出建議', 'vtuber-portal' ); ?></button>
		</form>
	</section>
	<?php
	// Contact / Advertise: prefer existing contact page, fallback to mailto admin.
	$contact_url = vtportal_url_with_lang( '/contact/', $current_lang );
	if ( '' === trim( (string) $contact_url ) ) {
		$contact_page = get_page_by_path( 'contact' );
		if ( ! $contact_page ) {
			$contact_page = get_page_by_path( 'contact-us' );
		}
		$contact_url = $contact_page ? get_permalink( $contact_page ) : 'mailto:' . antispambot( get_option( 'admin_email' ) );
	}
	?>
	<section class="vt-cta">
		<h3><?php esc_html_e( '想找特定 Vtuber？', 'vtuber-portal' ); ?></h3>
		<p><?php esc_html_e( '多語系、可擴充的 VTuber 資料庫，每日可自動新增與更新。', 'vtuber-portal' ); ?></p>
		<a class="vt-btn primary" href="<?php echo esc_url( $contact_url ); ?>"><?php esc_html_e( '聯絡我們 / 合作投放', 'vtuber-portal' ); ?></a>
	</section>
</main>
<script>
(()=> {
	const input = document.getElementById('vt-search-input');
	const results = document.getElementById('vt-search-results');
	if (!input || !results) return;

	const endpoint = "<?php echo esc_url( rest_url( 'vtportal/v1/search' ) ); ?>";
	const currentLang = "<?php echo esc_js( (string) $current_lang ); ?>";
	const supportedLangs = new Set(['cn', 'ja', 'en', 'ko', 'es', 'hi']);
	let timer;

	function normalizeText(s) {
		return (s || '')
			.toString()
			.toLowerCase()
			.replace(/<[^>]*>/g, '')
			.replace(/[^\p{L}\p{N}]+/gu, '')
			.trim();
	}

	function getLinkLang(link) {
		try {
			const u = new URL(link, window.location.origin);
			const seg = (u.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
			return supportedLangs.has(seg) ? seg : 'zh';
		} catch (e) {
			return 'zh';
		}
	}

	function isCurrentLangLink(link) {
		const lang = currentLang || 'zh';
		return getLinkLang(link) === lang;
	}

	function clearResults() {
		results.innerHTML = '';
		results.hidden = true;
	}

	async function doSearch(term) {
		if (!term || term.length < 2) {
			clearResults();
			return;
		}
		const url = new URL(endpoint);
		url.searchParams.set('q', term);
		url.searchParams.set('per_page', '6');
		if (currentLang) {
			url.searchParams.set('lang', currentLang);
		}
		try {
			const res = await fetch(url.toString(), { credentials: 'same-origin' });
			if (!res.ok) throw new Error('Search failed');
			const data = await res.json();
			if (!Array.isArray(data) || !data.length) {
				clearResults();
				return;
			}
			const sameLang = data.filter(item => isCurrentLangLink(item?.link || ''));
			const source = sameLang;
			if (!source.length) {
				clearResults();
				return;
			}
			const seen = new Set();
			const deduped = [];
			for (const item of source) {
				const title = (item?.title || '').toString();
				const link = (item?.link || '').toString();
				const key = normalizeText(title) + '|' + link;
				if (!title || !link) continue;
				if (seen.has(key)) continue;
				seen.add(key);
				deduped.push(item);
			}
			results.innerHTML = deduped.map(item => {
				const title = (item?.title || '').toString() || 'Result';
				const link = (item?.link || '').toString() || '#';
				return `
					<a class="vt-suggest" href="${link}">
						<span class="text">${title}</span>
					</a>
				`;
			}).join('');
			results.hidden = false;
		} catch (e) {
			clearResults();
		}
	}

	input.addEventListener('input', () => {
		clearTimeout(timer);
		timer = setTimeout(() => doSearch(input.value.trim()), 180);
	});

	document.addEventListener('click', (e) => {
		if (!results.contains(e.target) && e.target !== input) {
			clearResults();
		}
	});
})();
</script>
<?php wp_footer(); ?>
</body>
</html>

