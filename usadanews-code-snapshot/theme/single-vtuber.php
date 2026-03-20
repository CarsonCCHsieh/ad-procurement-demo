<?php
/**
 * Template: Single VTuber (standalone, no theme header/footer)
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

global $post;
$post_id = get_the_ID();
$current_lang = function_exists( 'pll_current_language' ) ? (string) pll_current_language( 'slug' ) : 'zh';

function vtportal_page_url_by_template_for_lang( $template, $lang = '' ) {
	$template = trim( (string) $template );
	$lang = sanitize_title( (string) $lang );
	if ( '' === $template ) {
		return '';
	}
	$q = new WP_Query(
		[
			'post_type'        => 'page',
			'post_status'      => 'publish',
			'posts_per_page'   => 1,
			'orderby'          => 'ID',
			'order'            => 'ASC',
			'fields'           => 'ids',
			'suppress_filters' => true,
			'meta_query'       => [
				[
					'key'   => '_wp_page_template',
					'value' => $template,
				],
			],
		]
	);
	$base_id = intval( $q->posts[0] ?? 0 );
	if ( $base_id <= 0 ) {
		return '';
	}
	if ( function_exists( 'pll_get_post_translations' ) && '' !== $lang ) {
		$map = pll_get_post_translations( $base_id );
		$tid = intval( is_array( $map ) ? ( $map[ $lang ] ?? 0 ) : 0 );
		if ( $tid > 0 ) {
			$u = get_permalink( $tid );
			if ( is_string( $u ) && '' !== $u ) {
				return $u;
			}
		}
	}
	$u = get_permalink( $base_id );
	return is_string( $u ) ? $u : '';
}

function vtportal_url_with_lang( $path, $lang = '' ) {
	$path = '/' . ltrim( (string) $path, '/' );
	$lang = sanitize_title( (string) $lang );
	$special_pages = [
		'/platforms/' => 'vt-platform-index.php',
		'/agencies/'  => 'vt-agency-index.php',
		'/countries/' => 'vt-country-index.php',
		'/debut-years/' => 'vt-debut-year-index.php',
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

$fields = [
	'display'   => function_exists( 'get_field' ) ? get_field( 'vt_display_name', $post_id ) : '',
	'original'  => function_exists( 'get_field' ) ? get_field( 'vt_original_name', $post_id ) : '',
	'affiliation' => function_exists( 'get_field' ) ? get_field( 'vt_affiliation', $post_id ) : '',
	'debut'     => function_exists( 'get_field' ) ? get_field( 'vt_debut_date', $post_id ) : '',
	'birthday'  => function_exists( 'get_field' ) ? get_field( 'vt_birthday', $post_id ) : '',
	'fan'       => function_exists( 'get_field' ) ? get_field( 'vt_fan_name', $post_id ) : '',
	'hashtags'  => function_exists( 'get_field' ) ? get_field( 'vt_hashtags', $post_id ) : '',
	'yt'        => function_exists( 'get_field' ) ? get_field( 'vt_youtube_subs', $post_id ) : '',
	'twitch'    => function_exists( 'get_field' ) ? get_field( 'vt_twitch_followers', $post_id ) : '',
	'rep'       => function_exists( 'get_field' ) ? get_field( 'vt_rep_video_url', $post_id ) : '',
	'summary'   => function_exists( 'get_field' ) ? get_field( 'vt_summary', $post_id ) : '',
	'faq'       => [
		['q' => function_exists( 'get_field' ) ? get_field( 'vt_faq_q1', $post_id ) : '', 'a' => function_exists( 'get_field' ) ? get_field( 'vt_faq_a1', $post_id ) : ''],
		['q' => function_exists( 'get_field' ) ? get_field( 'vt_faq_q2', $post_id ) : '', 'a' => function_exists( 'get_field' ) ? get_field( 'vt_faq_a2', $post_id ) : ''],
		['q' => function_exists( 'get_field' ) ? get_field( 'vt_faq_q3', $post_id ) : '', 'a' => function_exists( 'get_field' ) ? get_field( 'vt_faq_a3', $post_id ) : ''],
	],
];

$terms_agency   = get_the_terms( $post_id, 'agency' );
$terms_platform = get_the_terms( $post_id, 'platform' );
$terms_roles    = get_the_terms( $post_id, 'role-tag' );
$terms_life     = get_the_terms( $post_id, 'life-status' );
$terms_country  = get_the_terms( $post_id, 'country' );
$terms_debut_y  = get_the_terms( $post_id, 'debut-year' );

if ( ! function_exists( 'vtportal_normalize_life_slug' ) ) {
	function vtportal_normalize_life_slug( $raw_slug ) {
		$s = sanitize_title( (string) $raw_slug );
		if ( preg_match( '/^(active|graduated|reincarnated|hiatus)(?:-[a-z]{2,3})?$/i', $s, $m ) ) {
			return strtolower( (string) $m[1] );
		}
		return $s;
	}
}

$lifecycle_slug = 'active';
$lifecycle_label = '';
if ( ! empty( $terms_life ) && ! is_wp_error( $terms_life ) ) {
	$life_first = reset( $terms_life );
	if ( $life_first ) {
		if ( ! empty( $life_first->slug ) ) {
			$lifecycle_slug = vtportal_normalize_life_slug( (string) $life_first->slug );
		}
		if ( ! empty( $life_first->name ) ) {
			$lifecycle_label = (string) $life_first->name;
		}
	}
} else {
	$lifecycle_meta = (string) get_post_meta( $post_id, 'vt_lifecycle_status', true );
	if ( '' !== trim( $lifecycle_meta ) ) {
		$lifecycle_slug = vtportal_normalize_life_slug( $lifecycle_meta );
	}
}

if ( '' === trim( $lifecycle_label ) ) {
	$lifecycle_labels = [
		'active'       => __( '活動中', 'vtuber-portal' ),
		'graduated'    => __( '已畢業 / 引退', 'vtuber-portal' ),
		'reincarnated' => __( '轉生 / 前世', 'vtuber-portal' ),
		'hiatus'       => __( '休止中', 'vtuber-portal' ),
	];
	$lifecycle_label = $lifecycle_labels[ $lifecycle_slug ] ?? $lifecycle_labels['active'];
}
if ( function_exists( 'vtportal_term_label_translate' ) ) {
	$lifecycle_label = vtportal_term_label_translate( (string) $lifecycle_label, 'life-status', $current_lang );
}

// Prefer explicit field; fall back to the first assigned agency term.
$aff_display = (string) $fields['affiliation'];
if ( '' === trim( $aff_display ) && $terms_agency && ! is_wp_error( $terms_agency ) ) {
	$first = reset( $terms_agency );
	if ( $first && ! is_wp_error( $first ) && ! empty( $first->name ) ) {
		$aff_display = (string) $first->name;
	}
}

$country_display = '';
if ( $terms_country && ! is_wp_error( $terms_country ) ) {
	$t = reset( $terms_country );
	if ( $t && ! is_wp_error( $t ) && ! empty( $t->name ) ) {
		$country_display = (string) $t->name;
	}
}
if ( '' === trim( $country_display ) ) {
	$country_display = (string) get_post_meta( $post_id, 'vt_country_name', true );
}
if ( function_exists( 'vtportal_term_label_translate' ) && '' !== trim( $country_display ) ) {
	$country_display = vtportal_term_label_translate( (string) $country_display, 'country', $current_lang );
}

$debut_year_display = '';
if ( $terms_debut_y && ! is_wp_error( $terms_debut_y ) ) {
	$t = reset( $terms_debut_y );
	if ( $t && ! is_wp_error( $t ) && ! empty( $t->name ) ) {
		$debut_year_display = (string) $t->name;
	}
}
if ( '' === trim( $debut_year_display ) ) {
	$debut_year_display = vtportal_extract_year( (string) get_post_meta( $post_id, 'vt_debut_date', true ) );
}

$type_display = '';
if ( $terms_roles && ! is_wp_error( $terms_roles ) ) {
	foreach ( vtportal_filter_terms( $terms_roles ) as $rt ) {
		if ( in_array( (string) $rt->name, [ '個人勢', '企業勢', '社團勢' ], true ) ) {
			$type_display = (string) $rt->name;
			break;
		}
	}
}
if ( function_exists( 'vtportal_term_label_translate' ) && '' !== trim( $type_display ) ) {
	$type_display = vtportal_term_label_translate( (string) $type_display, 'role-tag', $current_lang );
}

function vtportal_render_terms( $terms ) {
	$terms = vtportal_filter_terms( $terms );
	if ( empty( $terms ) ) {
		return;
	}
	foreach ( $terms as $term ) {
		$term_name = trim( (string) $term->name );
		if ( '' === $term_name ) {
			continue;
		}
		$term_link = get_term_link( $term );
		if ( ! is_wp_error( $term_link ) ) {
			echo '<a class="vt-chip vt-chip-link" href="' . esc_url( $term_link ) . '">' . esc_html( $term_name ) . '</a>';
		} else {
			echo '<span class="vt-chip">' . esc_html( $term_name ) . '</span>';
		}
	}
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
		$out[] = $term;
	}
	return $out;
}

// Normalize agency display + related logic: "個人勢/Indie" is a role-tag, not an organization.
$terms_agency_public   = vtportal_filter_terms( $terms_agency );
$terms_platform_public = vtportal_filter_terms( $terms_platform );
$terms_country_public  = vtportal_filter_terms( $terms_country );
$terms_life_public     = vtportal_filter_terms( $terms_life );

$lifecycle_link = '';
if ( ! empty( $terms_life_public ) ) {
	$l_link = get_term_link( $terms_life_public[0] );
	if ( ! is_wp_error( $l_link ) ) {
		$lifecycle_link = (string) $l_link;
	}
}

$country_link = '';
if ( ! empty( $terms_country_public ) ) {
	$c_link = get_term_link( $terms_country_public[0] );
	if ( ! is_wp_error( $c_link ) ) {
		$country_link = (string) $c_link;
	}
}

if ( '' === trim( $aff_display ) && ! empty( $terms_agency_public ) ) {
	$first = reset( $terms_agency_public );
	if ( $first && ! is_wp_error( $first ) && ! empty( $first->name ) ) {
		$aff_display = (string) $first->name;
	}
}
if ( preg_match( '/^(indie|independent|solo|個人勢|個人)$/iu', trim( (string) $aff_display ) ) ) {
	$aff_display = '';
}

function vtportal_extract_year( $raw ) {
	$s = trim( (string) $raw );
	if ( '' === $s ) {
		return '';
	}
	if ( preg_match( '/\b(19\d{2}|20\d{2})\b/', $s, $m ) ) {
		return (string) $m[1];
	}
	if ( preg_match( '/^(19\d{2}|20\d{2})\d{4}$/', $s, $m ) ) {
		return (string) $m[1];
	}
	return '';
}

$vtportal_display_name = function ( $post_id ) {
	$b64 = get_post_meta( $post_id, 'vt_display_b64', true );
	if ( $b64 ) {
		$decoded = base64_decode( $b64, true );
		if ( $decoded ) {
			return $decoded;
		}
	}
	return get_the_title( $post_id );
};

$social_meta = [
	'vt_youtube_url'      => [ __( 'YouTube', 'vtuber-portal' ), 'vt-ico-yt' ],
	'vt_twitch_url'       => [ __( 'Twitch', 'vtuber-portal' ), 'vt-ico-tw' ],
	'vt_twitter_url'      => [ __( 'Twitter / X', 'vtuber-portal' ), 'vt-ico-x' ],
	'vt_facebook_url'     => [ __( 'Facebook', 'vtuber-portal' ), 'vt-ico-fb' ],
	'vt_bluesky_url'      => [ __( 'Bluesky', 'vtuber-portal' ), 'vt-ico-link' ],
	'vt_instagram'        => [ __( 'Instagram', 'vtuber-portal' ), 'vt-ico-ig' ],
	'vt_discord'          => [ __( 'Discord', 'vtuber-portal' ), 'vt-ico-discord' ],
	'vt_plurk'            => [ __( 'Plurk', 'vtuber-portal' ), 'vt-ico-plurk' ],
	'vt_marshmallow'      => [ __( '棉花糖', 'vtuber-portal' ), 'vt-ico-marsh' ],
	'vt_donate'           => [ __( '抖內 / Donate', 'vtuber-portal' ), 'vt-ico-coin' ],
	'vt_affiliation_url'  => [ __( '官方 / 所屬', 'vtuber-portal' ), 'vt-ico-link' ],
	'vt_email'            => [ __( 'Email', 'vtuber-portal' ), 'vt-ico-mail' ],
];
$social_links = [];
foreach ( $social_meta as $meta_key => $meta_info ) {
	$val = get_post_meta( $post_id, $meta_key, true );
	if ( $val ) {
		$social_links[ $meta_key ] = [
			'url'   => $val,
			'label' => $meta_info[0],
			'icon'  => $meta_info[1],
		];
	}
}

$social_counts = [
	'vt_youtube_url' => intval( $fields['yt'] ),
	'vt_twitch_url'  => intval( $fields['twitch'] ),
];

$social_order = [
	'vt_youtube_url',
	'vt_twitch_url',
	'vt_twitter_url',
	'vt_facebook_url',
	'vt_instagram',
	'vt_discord',
	'vt_bluesky_url',
	'vt_plurk',
	'vt_marshmallow',
	'vt_donate',
	'vt_affiliation_url',
	'vt_email',
];
$social_cards = [];
foreach ( $social_order as $key ) {
	if ( isset( $social_links[ $key ] ) ) {
		$card = $social_links[ $key ];
		$card['count'] = isset( $social_counts[ $key ] ) ? $social_counts[ $key ] : null;
		$social_cards[] = $card;
	}
}
?>
<!doctype html>
<html <?php echo function_exists( 'vtportal_language_attributes_markup' ) ? wp_kses_data( vtportal_language_attributes_markup() ) : get_language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php
	$manual_canonical = function_exists( 'vtportal_current_request_single_vtuber_canonical_url' )
		? vtportal_current_request_single_vtuber_canonical_url( get_post( $post_id ) )
		: get_permalink( $post_id );
	if ( $manual_canonical ) {
		echo '<link rel="canonical" href="' . esc_url( $manual_canonical ) . '">' . "\n";
	}
	// Avoid duplicating meta description if Yoast (or similar) is present.
	if ( ! defined( 'WPSEO_VERSION' ) ) {
		$meta_desc = trim( (string) ( $fields['summary'] ?: get_the_excerpt( $post_id ) ) );
		if ( function_exists( 'vtportal_localize_snippet_text' ) ) {
			$meta_desc = vtportal_localize_snippet_text( $meta_desc, $current_lang );
		}
		if ( '' !== $meta_desc ) {
			$meta_desc = wp_trim_words( wp_strip_all_tags( $meta_desc ), 36 );
			echo '<meta name="description" content="' . esc_attr( $meta_desc ) . '">' . "\n";
		}
	}
	if ( function_exists( 'vtportal_render_polylang_seo_links_for_post' ) ) {
		vtportal_render_polylang_seo_links_for_post( intval( $post_id ), false );
	} else {
		// Canonical already printed above.
	}
	?>
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'vt-landing vt-landing-single' ); ?>>
<main class="vt-layout" id="vt-top">
	<div class="vt-top-bar">
	<div class="vt-pill-nav" style="margin-bottom:0;">
		<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/', $current_lang ) ); ?>"><?php esc_html_e( '回首頁', 'vtuber-portal' ); ?></a>
		<a class="vt-pill" href="<?php echo esc_url( vtportal_archive_url_for_lang( 'vtuber', $current_lang ) ); ?>"><?php esc_html_e( '返回 VTuber 列表', 'vtuber-portal' ); ?></a>
		<a class="vt-pill" href="<?php echo esc_url( vtportal_url_with_lang( '/roles/', $current_lang ) ); ?>"><?php esc_html_e( '依風格', 'vtuber-portal' ); ?></a>
		<?php if ( ! empty( $terms_agency_public ) ) : ?>
			<?php foreach ( $terms_agency_public as $term ) : ?>
					<a class="vt-pill" href="<?php echo esc_url( get_term_link( $term ) ); ?>"><?php echo esc_html( sprintf( __( '更多 %s', 'vtuber-portal' ), $term->name ) ); ?></a>
				<?php endforeach; ?>
			<?php endif; ?>
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
	<div class="vt-two-col">
	<div class="vt-main-col">
	<section class="vt-hero">
		<div class="vt-hero-thumb">
			<?php
			$thumb = get_post_meta( $post_id, 'vt_thumb_url', true );
			if ( empty( $thumb ) ) {
				$thumb = get_post_meta( $post_id, 'vt_thumb_source_url', true );
			}
			if ( has_post_thumbnail() ) {
				the_post_thumbnail( 'large', [ 'alt' => esc_attr( $vtportal_display_name( $post_id ) ) ] );
			} elseif ( $thumb ) {
				echo '<img loading="lazy" decoding="async" src="' . esc_url( $thumb ) . '" alt="' . esc_attr( $vtportal_display_name( $post_id ) ) . '" />';
			} else {
				?>
				<img loading="lazy" decoding="async" src="<?php echo esc_url( VT_PORTAL_URL . 'assets/vt-placeholder.png' ); ?>" alt="<?php echo esc_attr( $vtportal_display_name( $post_id ) ); ?>" />
			<?php } ?>
		</div>
		<div class="vt-hero-body">
			<div class="vt-hero-head">
				<div>
					<p class="vt-kicker"><?php esc_html_e( 'VTuber Profile', 'vtuber-portal' ); ?></p>
					<h1><?php echo esc_html( $vtportal_display_name( $post_id ) ); ?></h1>
				</div>
			</div>
 			<div class="vt-meta-chips">
				<?php if ( '' !== $lifecycle_link ) : ?>
					<a class="vt-chip vt-chip-link" href="<?php echo esc_url( $lifecycle_link ); ?>"><?php echo esc_html( $lifecycle_label ); ?></a>
				<?php else : ?>
					<span class="vt-chip"><?php echo esc_html( $lifecycle_label ); ?></span>
				<?php endif; ?>
 				<?php if ( '' !== trim( $country_display ) ) : ?>
					<?php if ( '' !== $country_link ) : ?>
						<a class="vt-chip vt-chip-link" href="<?php echo esc_url( $country_link ); ?>"><?php echo esc_html( $country_display ); ?></a>
					<?php else : ?>
						<span class="vt-chip"><?php echo esc_html( $country_display ); ?></span>
					<?php endif; ?>
 				<?php endif; ?>
 				<?php if ( '' !== trim( (string) $debut_year_display ) && '0' !== trim( (string) $debut_year_display ) ) : ?>
 					<span class="vt-chip"><?php echo esc_html( (string) $debut_year_display ); ?></span>
 				<?php endif; ?>
 				<?php vtportal_render_terms( $terms_agency ); ?>
 				<?php vtportal_render_terms( $terms_platform ); ?>
 				<?php vtportal_render_terms( $terms_roles ); ?>
 			</div>
			<?php if ( ! empty( $social_cards ) ) : ?>
				<div class="vt-social-strip">
					<?php foreach ( $social_cards as $card ) : ?>
						<a class="vt-social-chip vt-social-link" href="<?php echo esc_url( $card['url'] ); ?>" target="_blank" rel="noopener">
							<span class="vt-ico <?php echo esc_attr( $card['icon'] ); ?>" aria-hidden="true"></span>
							<span>
								<?php echo esc_html( $card['label'] ); ?>
								<?php if ( null !== $card['count'] && intval( $card['count'] ) > 0 ) : ?>
									<?php echo ' ' . esc_html( number_format_i18n( $card['count'] ) ); ?>
								<?php endif; ?>
							</span>
						</a>
					<?php endforeach; ?>
				</div>
			<?php endif; ?>
 			<div class="vt-quick-grid">
 				<div class="vt-quick"><div class="label"><?php esc_html_e( '顯示名', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( $fields['display'] ?: get_the_title() ); ?></div></div>
 				<div class="vt-quick"><div class="label"><?php esc_html_e( '出道', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( $fields['debut'] ); ?></div></div>
				<div class="vt-quick"><div class="label"><?php esc_html_e( '出道年', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( (string) $debut_year_display ); ?></div></div>
 				<div class="vt-quick"><div class="label"><?php esc_html_e( '生日/設定', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( $fields['birthday'] ); ?></div></div>
				<div class="vt-quick"><div class="label"><?php esc_html_e( '國家/地區', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( $country_display ); ?></div></div>
 				<div class="vt-quick"><div class="label"><?php esc_html_e( '粉絲名', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( $fields['fan'] ); ?></div></div>
 				<div class="vt-quick"><div class="label"><?php esc_html_e( '常用 Hashtag', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( $fields['hashtags'] ); ?></div></div>
				<div class="vt-quick"><div class="label"><?php esc_html_e( '所屬組織', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( '' !== trim( $aff_display ) ? $aff_display : '-' ); ?></div></div>
				<?php if ( '' !== trim( $type_display ) ) : ?>
					<div class="vt-quick"><div class="label"><?php esc_html_e( '類型', 'vtuber-portal' ); ?></div><div class="value"><?php echo esc_html( $type_display ); ?></div></div>
				<?php endif; ?>
 			</div>
		</div>
	</section>

	<div class="vt-detail-layout">
		<div class="vt-detail-primary">
			<section class="vt-section" id="vt-summary">
				<h2><?php esc_html_e( 'Twitch簡介', 'vtuber-portal' ); ?></h2>
				<div class="vt-body-text">
					<?php
					$summary_html = (string) get_post_meta( $post_id, 'vt_summary_html', true );
					if ( '' !== trim( $summary_html ) ) {
						if ( function_exists( 'vtportal_localize_snippet_text' ) ) {
							$summary_html = vtportal_localize_snippet_text( $summary_html, $current_lang );
						}
						echo wp_kses_post( $summary_html );
					} elseif ( $fields['summary'] ) {
						$summary_plain = (string) $fields['summary'];
						if ( function_exists( 'vtportal_localize_snippet_text' ) ) {
							$summary_plain = vtportal_localize_snippet_text( $summary_plain, $current_lang );
						}
						echo wpautop( esc_html( $summary_plain ) );
					} else {
						the_excerpt();
					}
					?>
				</div>
				<?php if ( $fields['rep'] ) : ?>
					<div class="vt-video">
						<?php
						$embed = wp_oembed_get( $fields['rep'] );
						if ( $embed ) {
							if ( false !== stripos( $embed, 'youtube.com/embed/' ) ) {
								$embed = str_replace( 'https://www.youtube.com/embed/', 'https://www.youtube-nocookie.com/embed/', $embed );
								if ( false === stripos( $embed, ' loading=' ) ) {
									$embed = preg_replace( '/<iframe\b/i', '<iframe loading="lazy" decoding="async" referrerpolicy="strict-origin-when-cross-origin"', $embed, 1 );
								}
							}
							echo $embed; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
						} else {
							echo '<a href="' . esc_url( $fields['rep'] ) . '" target="_blank" rel="noopener">' . esc_html__( '觀看代表影片', 'vtuber-portal' ) . '</a>';
						}
						?>
					</div>
				<?php endif; ?>
			</section>

			<section class="vt-section" id="vt-faq">
				<h2><?php esc_html_e( '常見問答', 'vtuber-portal' ); ?></h2>
				<div class="vt-faq">
					<?php foreach ( $fields['faq'] as $item ) :
						if ( ! $item['q'] || ! $item['a'] ) {
							continue;
						}
						?>
						<div class="vt-faq-item">
							<h3><?php echo esc_html( $item['q'] ); ?></h3>
							<p><?php echo esc_html( $item['a'] ); ?></p>
						</div>
					<?php endforeach; ?>
				</div>
			</section>
		</div>

		<div class="vt-detail-secondary">
			<section class="vt-section vt-body-text" id="vt-content">
				<h2><?php esc_html_e( '完整介紹', 'vtuber-portal' ); ?></h2>
				<?php the_content(); ?>
			</section>
		</div>
	</div>

	<?php
	// Related VTubers.
	// - Prefer same agency (excluding Indie/個人勢).
	// - Otherwise fall back to same platform, then same country.
	$related_tax   = '';
	$related_terms = [];
	$related_h2    = '';
	$related_nav   = '';

	if ( ! empty( $terms_agency_public ) ) {
		$related_tax   = 'agency';
		$related_terms = wp_list_pluck( $terms_agency_public, 'term_id' );
		$related_h2    = __( '同組織的 VTuber', 'vtuber-portal' );
		$related_nav   = __( '同組織 VTuber', 'vtuber-portal' );
	} elseif ( ! empty( $terms_platform_public ) ) {
		$related_tax   = 'platform';
		$related_terms = wp_list_pluck( $terms_platform_public, 'term_id' );
		$related_h2    = __( '同平台的 VTuber', 'vtuber-portal' );
		$related_nav   = __( '同平台 VTuber', 'vtuber-portal' );
	} elseif ( ! empty( $terms_country_public ) ) {
		$related_tax   = 'country';
		$related_terms = wp_list_pluck( $terms_country_public, 'term_id' );
		$related_h2    = __( '同國家/地區的 VTuber', 'vtuber-portal' );
		$related_nav   = __( '同國家 VTuber', 'vtuber-portal' );
	}

	$related = null;
	$has_related = false;
	if ( '' !== $related_tax && ! empty( $related_terms ) ) {
		$related = new WP_Query(
			[
				'post_type'      => 'vtuber',
				'posts_per_page' => 6,
				'post__not_in'   => [ $post_id ],
				'lang'           => $current_lang,
				'tax_query'      => [
					[
						'taxonomy' => $related_tax,
						'field'    => 'term_id',
						'terms'    => array_values( array_unique( array_map( 'intval', (array) $related_terms ) ) ),
					],
				],
			]
		);
		$has_related = $related->have_posts();
	}
	if ( $has_related ) : ?>
		<section class="vt-section" id="vt-related">
			<h2><?php echo esc_html( $related_h2 ); ?></h2>
			<div class="vt-card-grid neo">
					<?php while ( $related->have_posts() ) : $related->the_post(); ?>
						<article class="vt-card">
							<a class="vt-card-block" href="<?php the_permalink(); ?>">
								<?php
								$related_thumb = get_post_meta( get_the_ID(), 'vt_thumb_url', true );
								if ( empty( $related_thumb ) ) {
									$related_thumb = get_post_meta( get_the_ID(), 'vt_thumb_source_url', true );
								}
								?>
								<?php if ( has_post_thumbnail() ) : ?>
									<span class="vt-card-thumb-wrap"><?php the_post_thumbnail( 'medium', [ 'class' => 'vt-card-thumb', 'alt' => esc_attr( $vtportal_display_name( get_the_ID() ) ) ] ); ?></span>
								<?php elseif ( $related_thumb ) : ?>
									<span class="vt-card-thumb-wrap"><img class="vt-card-thumb" src="<?php echo esc_url( $related_thumb ); ?>" alt="<?php echo esc_attr( $vtportal_display_name( get_the_ID() ) ); ?>" /></span>
								<?php else : ?>
									<span class="vt-card-thumb-wrap"><img class="vt-card-thumb" src="<?php echo esc_url( VT_PORTAL_URL . 'assets/vt-placeholder.png' ); ?>" alt="<?php echo esc_attr( $vtportal_display_name( get_the_ID() ) ); ?>" /></span>
								<?php endif; ?>
							<div class="vt-card-body">
								<h3 class="vt-card-title"><?php the_title(); ?></h3>
								<?php
								$related_excerpt_raw = (string) get_the_excerpt();
								if ( function_exists( 'vtportal_localize_snippet_text' ) ) {
									$related_excerpt_raw = vtportal_localize_snippet_text( $related_excerpt_raw, $current_lang );
								}
								?>
								<p class="vt-card-excerpt"><?php echo esc_html( wp_trim_words( $related_excerpt_raw, 15 ) ); ?></p>
							</div>
						</a>
					</article>
				<?php endwhile; wp_reset_postdata(); ?>
			</div>
		</section>
	<?php endif; ?>
	</div>
	<div class="vt-aside-sticky">
		<aside class="vt-aside-card vt-aside-summary">
			<h2><?php esc_html_e( '快速摘要', 'vtuber-portal' ); ?></h2>
			<div class="vt-aside-kv">
				<div class="k"><?php esc_html_e( '更新時間', 'vtuber-portal' ); ?></div>
				<div class="v"><?php echo esc_html( get_the_modified_date( 'Y-m-d H:i' ) ); ?></div>
			</div>
			<?php if ( ! empty( $fields['yt'] ) ) : ?>
				<div class="vt-aside-kv"><div class="k"><?php esc_html_e( 'YouTube', 'vtuber-portal' ); ?></div><div class="v"><?php echo esc_html( number_format_i18n( intval( $fields['yt'] ) ) ); ?></div></div>
			<?php endif; ?>
			<?php if ( ! empty( $fields['twitch'] ) ) : ?>
				<div class="vt-aside-kv"><div class="k"><?php esc_html_e( 'Twitch', 'vtuber-portal' ); ?></div><div class="v"><?php echo esc_html( number_format_i18n( intval( $fields['twitch'] ) ) ); ?></div></div>
			<?php endif; ?>
			<?php if ( ! empty( $aff_display ) ) : ?>
				<div class="vt-aside-kv"><div class="k"><?php esc_html_e( '組織', 'vtuber-portal' ); ?></div><div class="v"><?php echo esc_html( $aff_display ); ?></div></div>
			<?php endif; ?>
			<div class="vt-aside-kv"><div class="k"><?php esc_html_e( '狀態', 'vtuber-portal' ); ?></div><div class="v"><?php echo esc_html( $lifecycle_label ); ?></div></div>
		</aside>

		<aside class="vt-aside-card vt-aside-nav">
			<h2><?php esc_html_e( '頁面導覽', 'vtuber-portal' ); ?></h2>
			<a href="#vt-top"><?php esc_html_e( '回到頂部', 'vtuber-portal' ); ?></a>
			<a href="#vt-summary"><?php esc_html_e( 'Twitch簡介', 'vtuber-portal' ); ?></a>
			<a href="#vt-faq"><?php esc_html_e( '常見問答', 'vtuber-portal' ); ?></a>
			<a href="#vt-content"><?php esc_html_e( '完整介紹', 'vtuber-portal' ); ?></a>
			<?php if ( $has_related ) : ?>
				<a href="#vt-related"><?php echo esc_html( $related_nav ); ?></a>
			<?php endif; ?>
		</aside>

		<aside class="vt-aside-card vt-aside-news">
			<h2><?php esc_html_e( '最新新聞（外部連結）', 'vtuber-portal' ); ?></h2>
			<?php
			if ( function_exists( 'vt_news_render_related' ) ) {
				vt_news_render_related( $vtportal_display_name( $post_id ), 6, '' );
			} else {
				echo '<p class="vt-aside-muted">' . esc_html__( '目前未啟用新聞聚合模組。', 'vtuber-portal' ) . '</p>';
			}
			?>
		</aside>
	</div>
	</div>
</main>
<?php wp_footer(); ?>
</body>
</html>
