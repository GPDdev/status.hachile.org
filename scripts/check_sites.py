"""Check the HTTP entry points listed in the Hachile directory."""

import argparse
import json
import os
import socket
import ssl
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class Directory(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.sites = []
        self.urls = set()
        self.link = None
        self.label_depth = 0
        self.label = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get("class") or "").split()
        if tag == "a" and "site-link" in classes:
            self.link = (attrs.get("href") or "").strip()
            self.label_depth = 0
            self.label = []
        elif tag == "span" and self.link is not None:
            if self.label_depth:
                self.label_depth += 1
            elif "site-name" in classes:
                self.label_depth = 1

    def handle_data(self, data):
        # The nested span in a site name is its decorative arrow.
        if self.label_depth == 1:
            self.label.append(data)

    def handle_endtag(self, tag):
        if tag == "span" and self.label_depth:
            self.label_depth -= 1
        elif tag == "a" and self.link is not None:
            url = urlsplit(self.link)
            host = url.hostname or ""
            if (
                url.scheme not in {"https", "http"}
                or not (host == "hachile.org" or host.endswith(".hachile.org"))
                or url.username is not None
                or url.password is not None
                or url.port is not None
            ):
                raise ValueError(f"Unexpected directory URL: {self.link!r}")
            if self.link not in self.urls:
                self.sites.append({"name": "".join(self.label).strip() or host, "url": self.link})
                self.urls.add(self.link)
            self.link = None
            self.label_depth = 0


def read_directory(html):
    directory = Directory()
    directory.feed(html)
    directory.close()
    if not directory.sites:
        raise ValueError("The directory contains no site links")
    return directory.sites


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def failure_reason(error):
    if isinstance(error, (TimeoutError, socket.timeout)):
        return "连接超时"
    if isinstance(error, socket.gaierror):
        return "域名解析失败"
    if isinstance(error, ssl.SSLError):
        return "TLS 连接失败"
    return "无法连接站点"


def request_once(url):
    request = Request(url, headers={"User-Agent": "HachileStatus/1.0 (+https://status.hachile.org/)"})
    try:
        with urlopen(request, timeout=8) as response:
            code = response.status
            return code, None if 200 <= code < 300 else f"HTTP {code}"
    except HTTPError as error:
        with error:
            return error.code, f"HTTP {error.code}"
    except URLError as error:
        return None, failure_reason(error.reason)
    except (OSError, HTTPException, ValueError) as error:
        return None, failure_reason(error)


def check_site(site, request=request_once, sleep=time.sleep, clock=timestamp):
    code, detail = request(site["url"])
    if detail is not None:
        sleep(2)
        code, detail = request(site["url"])
    return {
        **site,
        "status": "up" if detail is None else "down",
        "checkedAt": clock(),
        "httpStatus": code,
        "detail": detail,
    }


def make_snapshot(previous, sites, checked_at):
    if previous.get("schemaVersion") != 1 or not isinstance(previous.get("incidents"), list):
        raise ValueError("Invalid stored status history")
    incidents = [dict(item) for item in previous["incidents"]]
    active = {event["url"]: event for event in incidents if event["resolvedAt"] is None}
    for site in sites:
        event = active.get(site["url"])
        if site["status"] == "down" and event is None:
            incidents.append({
                "name": site["name"],
                "url": site["url"],
                "startedAt": site["checkedAt"],
                "resolvedAt": None,
                "detail": site["detail"],
            })
        elif site["status"] == "up" and event is not None:
            event["resolvedAt"] = site["checkedAt"]
    incidents.sort(key=lambda item: item["startedAt"], reverse=True)
    return {"schemaVersion": 1, "checkedAt": checked_at, "sites": sites, "incidents": incidents}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("index.html"))
    parser.add_argument("--output", type=Path, default=Path("data/status.json"))
    parser.add_argument("--previous", type=Path, help="Required to exist if supplied")
    args = parser.parse_args()
    previous = {"schemaVersion": 1, "incidents": []}
    if args.previous is not None:
        previous = json.loads(args.previous.read_text(encoding="utf-8"))
    directory = read_directory(args.directory.read_text(encoding="utf-8"))
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(check_site, directory))
    snapshot = make_snapshot(previous, results, timestamp())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False,
                                     dir=args.output.parent) as temporary:
        json.dump(snapshot, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
    os.replace(temporary.name, args.output)
    count_up = sum(item["status"] == "up" for item in results)
    print(f"{snapshot['checkedAt']}: {count_up}/{len(results)} sites accessible")


if __name__ == "__main__":
    main()
