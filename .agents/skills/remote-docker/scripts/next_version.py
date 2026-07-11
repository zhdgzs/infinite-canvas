#!/usr/bin/env python3

import argparse
import re


VERSION_PATTERN = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


def next_version(current: str, level: str) -> str:
    match = VERSION_PATTERN.fullmatch(current.strip())
    if not match:
        raise ValueError("version must use MAJOR.MINOR.PATCH format")

    major, minor, patch = map(int, match.groups())
    if major < 1:
        return "v1.0.0"
    if level == "large":
        return f"v{major}.{minor + 1}.0"
    return f"v{major}.{minor}.{patch + 1}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Calculate the next remote-docker release version.")
    parser.add_argument("--current", required=True)
    parser.add_argument("--level", choices=("small", "large"), required=True)
    args = parser.parse_args()

    try:
        print(next_version(args.current, args.level))
    except ValueError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
