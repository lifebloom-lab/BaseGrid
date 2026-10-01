"""Relay checks with mocked upstream responses; no live keys or API credits used."""
import io
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch, MagicMock
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class RouteTests(unittest.TestCase):
    def test_only_supported_read_routes(self):
        self.assertEqual(server.upstream_path('/api/lastwar/rankings/1234/alliances'), '/rankings/1234/alliances?limit=200')
        self.assertEqual(server.upstream_path('/api/lastwar/alliance/' + 'A' * 32 + '/members'), '/alliance/' + 'a' * 32 + '/members?sort_by=power&descending=true')
        for path in ['/api/lastwar/https://evil.example', '/api/lastwar/auth/sessions', '/api/lastwar/rankings/0/alliances', '/api/lastwar/alliance/../members']:
            with self.assertRaises(ValueError):
                server.upstream_path(path)

    def test_upstream_key_is_header_only_and_json_is_returned(self):
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value.read.return_value = b'{"members": []}'
        with patch.object(server.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(server.fetch_upstream('/alliance/id/members', 'test-key'), (200, {'members': []}))
        request = opener.open.call_args.args[0]
        self.assertTrue(request.full_url.startswith('https://api.lastwar.tools/'))
        self.assertNotIn('test-key', request.full_url)
        self.assertEqual(request.get_header('X-api-key'), 'test-key')

    def test_upstream_errors_never_echo_secret_details(self):
        opener = MagicMock()
        opener.open.side_effect = urllib.error.HTTPError('https://api.lastwar.tools', 401, 'secret', {}, io.BytesIO(b'{"key":"secret"}'))
        with patch.object(server.urllib.request, 'build_opener', return_value=opener):
            status, body = server.fetch_upstream('/path', 'secret')
        self.assertEqual(status, 401)
        self.assertNotIn('secret', json.dumps(body))

    def test_timeout_invalid_json_and_oversized_response(self):
        opener = MagicMock()
        with patch.object(server.urllib.request, 'build_opener', return_value=opener):
            opener.open.side_effect = TimeoutError()
            self.assertEqual(server.fetch_upstream('/path', 'key')[0], 504)
            opener.open.side_effect = None
            for body in [b'not json', b'x' * (server.MAX_RESPONSE + 1)]:
                opener.open.return_value.__enter__.return_value.read.return_value = body
                self.assertEqual(server.fetch_upstream('/path', 'key')[0], 502)

    def test_redirects_are_not_followed(self):
        self.assertIsNone(server.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example'))


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.httpd.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def get(self, path, headers=None):
        request = urllib.request.Request(self.base + path, headers=headers or {})
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    def test_allowed_app_assets_and_private_files(self):
        for path in ['/', '/ui.js', '/import-ui.js', '/lastwar-api.js', '/roster-cache.js', '/reorder-ui.js',
                     '/tile-placement.js', '/placement-messages.js', '/free-formation.js', '/grid-layout.js', '/placement.js',
                     '/players.js', '/storage.js', '/styles.css', '/lifebloom-zombie.png']:
            self.assertEqual(self.get(path)[0], 200)
        for path in ['/.git/config', '/.env', '/server.py', '/tests/', '/../.git/config']:
            self.assertEqual(self.get(path)[0], 404)

    def test_missing_key_and_disallowed_query_do_not_call_upstream(self):
        with patch.object(server, 'fetch_upstream') as upstream:
            self.assertEqual(self.get('/api/lastwar/rankings/1234/alliances')[0], 401)
            self.assertEqual(self.get('/api/lastwar/rankings/1234/alliances?api_key=secret')[0], 404)
            upstream.assert_not_called()

    def test_cross_origin_request_is_rejected(self):
        with patch.object(server, 'fetch_upstream') as upstream:
            status, _, _ = self.get('/api/lastwar/rankings/1234/alliances', {'X-API-Key': 'key', 'Origin': 'https://other.example'})
            self.assertEqual(status, 403)
            upstream.assert_not_called()

    def test_proxy_response_and_no_cache_headers(self):
        with patch.object(server, 'fetch_upstream', return_value=(200, [{'name': 'Alliance'}])) as upstream:
            status, headers, body = self.get('/api/lastwar/rankings/1234/alliances', {'X-API-Key': 'key', 'Origin': self.base})
        self.assertEqual(status, 200)
        self.assertEqual(headers['X-BaseGrid-Relay'], '1')
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(json.loads(body), [{'name': 'Alliance'}])
        upstream.assert_called_once_with('/rankings/1234/alliances?limit=200', 'key')


if __name__ == '__main__':
    unittest.main()
