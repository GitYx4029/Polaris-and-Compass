// Public data delivery is independent of repository visibility. Never put GitHub credentials here.
export const publicSiteOrigin = "https://a-share-pulse-lxy-0924.reagan-park-6434.chatgpt.site";
export function dataUrls(name:string):string[]{
  const origin=typeof window!=="undefined"&&window.location.hostname.endsWith(".github.io")?publicSiteOrigin:"";
  return [`${origin}/api/data/${encodeURIComponent(name)}`];
}
