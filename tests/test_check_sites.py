import importlib.util
import unittest
from pathlib import Path


source = Path(__file__).resolve().parents[1] / "scripts" / "check_sites.py"
spec = importlib.util.spec_from_file_location("check_sites", source)
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorTest(unittest.TestCase):
    site = {"name": "Home", "url": "https://home.hachile.org/"}

    def test_directory_uses_entries_not_other_navigation_or_decorative_names(self):
        html = """
          <a href="https://other.example/">Project credits</a>
          <a href="https://home.hachile.org/" class="primary site-link">
            <span class="site-name">Home<span class="site-arrow">↗</span></span></a>
          <a class="site-link" href="https://home.hachile.org/">Same destination</a>
          <a class="site-link" href="https://hachile.org/">Portal</a>
        """
        entries = monitor.read_directory(html)
        self.assertEqual(entries, [self.site, {"name": "hachile.org", "url": "https://hachile.org/"}])
        with self.assertRaises(ValueError):
            monitor.read_directory("<p>Broken directory</p>")
        with self.assertRaises(ValueError):
            monitor.read_directory('<a class="site-link" href="https://hachile.org.evil.test/">Foreign</a>')

    def test_transient_error_recovers_without_recording_an_outage(self):
        replies = iter([(503, "HTTP 503"), (200, None)])
        checked = monitor.check_site(self.site, lambda url: next(replies), lambda seconds: None, lambda: "t1")
        state = monitor.make_snapshot({"schemaVersion": 1, "incidents": []}, [checked], "t1")
        self.assertEqual(state["sites"][0]["status"], "up")
        self.assertEqual(state["incidents"], [])

    def test_persistent_failure_single_incident_then_recovery_and_relapse(self):
        state = {"schemaVersion": 1, "incidents": []}
        for detail, instant in [("连接超时", "t1"), ("HTTP 503", "t2"), (None, "t3"), ("连接超时", "t4")]:
            def response(url):
                if detail is None:
                    return 200, None
                return (503 if detail == "HTTP 503" else None), detail

            checked = monitor.check_site(self.site, response, lambda seconds: None, lambda: instant)
            state = monitor.make_snapshot(state, [checked], instant)
        self.assertEqual([(i["startedAt"], i["resolvedAt"]) for i in state["incidents"]],
                         [("t4", None), ("t1", "t3")])
        self.assertEqual(state["sites"][0]["checkedAt"], "t4")

    def test_invalid_prior_state_cannot_silently_reset_history(self):
        with self.assertRaises(ValueError):
            monitor.make_snapshot({"schemaVersion": 2}, [], "t1")


if __name__ == "__main__":
    unittest.main()
