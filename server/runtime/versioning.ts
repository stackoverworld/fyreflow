interface ParsedSemverLike {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

const SEMVER_LIKE_PATTERN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function toSafeInteger(raw: string | undefined): number {
  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function parseSemverLike(raw: string | undefined): ParsedSemverLike | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = trimmed.match(SEMVER_LIKE_PATTERN);
  if (!match) {
    return null;
  }

  return {
    major: toSafeInteger(match[1]),
    minor: toSafeInteger(match[2]),
    patch: toSafeInteger(match[3]),
    prerelease: typeof match[4] === "string" ? match[4].trim() : ""
  };
}

function comparePrerelease(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }

  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];

    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);

    if (leftNumeric && rightNumeric) {
      const leftValue = Number.parseInt(leftPart, 10);
      const rightValue = Number.parseInt(rightPart, 10);
      if (leftValue < rightValue) {
        return -1;
      }
      if (leftValue > rightValue) {
        return 1;
      }
      continue;
    }

    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }

    return leftPart < rightPart ? -1 : 1;
  }

  return 0;
}

function compareParsedVersions(left: ParsedSemverLike, right: ParsedSemverLike): number {
  if (left.major !== right.major) {
    return left.major < right.major ? -1 : 1;
  }

  if (left.minor !== right.minor) {
    return left.minor < right.minor ? -1 : 1;
  }

  if (left.patch !== right.patch) {
    return left.patch < right.patch ? -1 : 1;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

export function normalizeSemverLikeVersion(raw: string | undefined): string {
  const parsed = parseSemverLike(raw);
  if (!parsed) {
    return "";
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ""}`;
}

export function compareSemverLikeVersions(leftRaw: string | undefined, rightRaw: string | undefined): number | null {
  const left = parseSemverLike(leftRaw);
  const right = parseSemverLike(rightRaw);

  if (!left || !right) {
    return null;
  }

  return compareParsedVersions(left, right);
}
