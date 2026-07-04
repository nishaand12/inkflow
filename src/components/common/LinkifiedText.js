import React from "react";

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?"')\]}>])/gi;

function trimTrailingPunctuation(url) {
  const match = url.match(/[.,;:!?)]+$/);
  if (!match) return { href: url, suffix: "" };
  return { href: url.slice(0, -match[0].length), suffix: match[0] };
}

export function textContainsUrl(text) {
  if (!text) return false;
  URL_PATTERN.lastIndex = 0;
  return URL_PATTERN.test(text);
}

export default function LinkifiedText({ text, className }) {
  if (!text) return null;

  const parts = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    const { href, suffix } = trimTrailingPunctuation(match[0]);
    parts.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-600 underline underline-offset-2 hover:text-indigo-800 break-all"
      >
        {href}
      </a>
    );
    if (suffix) parts.push(suffix);

    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className={className}>{parts.length ? parts : text}</span>;
}
