Deno.serve(async () => {
  const out: any = { ok: true };
  try {
    const r = await fetch("https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&titles=Kylian%20Mbapp%C3%A9&format=json&pithumbsize=200", { signal: AbortSignal.timeout(12000) });
    out.status = r.status;
    const d = await r.json();
    const pages = d?.query?.pages || {};
    out.thumb = Object.values(pages)[0]?.thumbnail?.source || null;
  } catch (e: any) { out.ok = false; err: out.err = String(e?.message || e); }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
});
