<?php
declare(strict_types=1);

/**
 * One-shot remote DB dumper for WordPress shared hosting.
 *
 * Usage:
 *   1. Upload this file into the WordPress document root as a random filename.
 *   2. Replace __TOKEN__ before upload.
 *   3. Call: /<random>.php?token=<token>&action=dump
 *   4. Download the generated .sql.gz from /.well-known/usada-migration/
 *   5. Delete both the generated dump and this script.
 */

@set_time_limit(0);
@ini_set('memory_limit', '-1');
@ini_set('display_errors', '1');
@error_reporting(E_ALL);

$token = '__TOKEN__';

function json_response(int $code, array $payload): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

register_shutdown_function(static function (): void {
    $e = error_get_last();
    if (!$e) {
        return;
    }
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode([
        'ok' => false,
        'fatal' => true,
        'type' => $e['type'] ?? null,
        'message' => $e['message'] ?? '',
        'file' => $e['file'] ?? '',
        'line' => $e['line'] ?? 0,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
});

if (!hash_equals($token, (string)($_GET['token'] ?? ''))) {
    json_response(403, ['ok' => false, 'error' => 'forbidden']);
}

$requestedAction = (string)($_GET['action'] ?? 'dump');
$baseDir = __DIR__;
$wpLoad = $baseDir . '/wp-load.php';
if (!is_file($wpLoad)) {
    $candidate = dirname($baseDir) . '/wp-load.php';
    if (is_file($candidate)) {
        $wpLoad = $candidate;
        $baseDir = dirname($candidate);
    }
}
$exportDir = $baseDir . '/.well-known/usada-migration';
if (!is_dir($exportDir) && !@mkdir($exportDir, 0755, true) && !is_dir($exportDir)) {
    json_response(500, ['ok' => false, 'error' => 'failed_to_create_export_dir']);
}

if (!defined('SHORTINIT')) {
    define('SHORTINIT', true);
}
require_once $wpLoad;

$dbName = defined('DB_NAME') ? DB_NAME : '';
$dbUser = defined('DB_USER') ? DB_USER : '';
$dbPass = defined('DB_PASSWORD') ? DB_PASSWORD : '';
$dbHost = defined('DB_HOST') ? DB_HOST : 'localhost';
$dbCharset = defined('DB_CHARSET') ? DB_CHARSET : 'utf8mb4';

if ($dbName === '' || $dbUser === '' || $dbHost === '') {
    json_response(500, ['ok' => false, 'error' => 'db_config_missing']);
}

if ($requestedAction === 'cleanup') {
    $deleted = [];
    foreach (glob($exportDir . '/*.sql.gz') ?: [] as $f) {
        if (@unlink($f)) {
            $deleted[] = basename($f);
        }
    }
    json_response(200, ['ok' => true, 'deleted' => $deleted]);
}

if ($requestedAction !== 'dump') {
    json_response(400, ['ok' => false, 'error' => 'unsupported_action']);
}

$timestamp = gmdate('Ymd_His');
$filename = "usada-db-{$timestamp}.sql.gz";
$filepath = $exportDir . '/' . $filename;

$hostPart = $dbHost;
$portPart = '3306';
if (strpos($dbHost, ':') !== false) {
    [$hostPart, $portPart] = array_pad(explode(':', $dbHost, 2), 2, '3306');
}

$cmd = sprintf(
    'mysqldump --single-transaction --quick --default-character-set=%s --host=%s --port=%s --user=%s --password=%s %s 2>&1 | gzip -c > %s',
    escapeshellarg($dbCharset),
    escapeshellarg($hostPart),
    escapeshellarg($portPart),
    escapeshellarg($dbUser),
    escapeshellarg($dbPass),
    escapeshellarg($dbName),
    escapeshellarg($filepath)
);

$output = [];
$exitCode = 0;
@exec($cmd, $output, $exitCode);

clearstatcache(true, $filepath);

if ($exitCode !== 0 || !is_file($filepath) || filesize($filepath) < 1024) {
    json_response(500, [
        'ok' => false,
        'error' => 'mysqldump_failed',
        'exit_code' => $exitCode,
        'output' => $output,
        'filepath' => $filepath,
        'filesize' => is_file($filepath) ? filesize($filepath) : 0,
    ]);
}

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = (string)($_SERVER['HTTP_HOST'] ?? '');
$baseUrl = $scheme . '://' . $host;

json_response(200, [
    'ok' => true,
    'file' => $filename,
    'path' => '/.well-known/usada-migration/' . $filename,
    'url' => $baseUrl . '/.well-known/usada-migration/' . $filename,
    'bytes' => filesize($filepath),
]);
