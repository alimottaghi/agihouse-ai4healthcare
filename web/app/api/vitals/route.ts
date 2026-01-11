import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://localhost:8000";

function normalizeTypes(params: URLSearchParams): string[] {
  return params
    .getAll("types")
    .flatMap((t) => t.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const spIn = url.searchParams;

  const filePath =
    spIn.get("file_path") ||
    process.env.APPLE_XML_PATH ||
    process.env.NEXT_PUBLIC_APPLE_XML_PATH ||
    "";

  if (!filePath) {
    return NextResponse.json(
      { error: "Missing 'file_path' and no default APPLE_XML_PATH is configured." },
      { status: 400 }
    );
  }

  const spOut = new URLSearchParams();
  spOut.set("file_path", filePath);
  for (const t of normalizeTypes(spIn)) spOut.append("types", t);
  for (const k of ["start", "end"] as const) {
    const v = spIn.get(k);
    if (v !== null && v !== "") spOut.set(k, v);
  }

  const upstream = `${FASTAPI_URL.replace(/\/$/, "")}/vitals?${spOut.toString()}`;

  try {
    const res = await fetch(upstream, { cache: "no-store" });
    const text = await res.text();

    if (!res.ok) {
      let detail: any = null;
      try { detail = JSON.parse(text); } catch {}
      const message = detail?.detail ?? detail?.error ?? `Upstream error (${res.status})`;
      return NextResponse.json({ error: message, upstreamStatus: res.status }, { status: res.status });
    }

    const data = text ? JSON.parse(text) : [];
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });

    const total = res.headers.get("X-Total-Count");
    if (total) headers.set("X-Total-Count", total);

    return new NextResponse(JSON.stringify(data), { status: 200, headers });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error while contacting the API." },
      { status: 500 }
    );
  }
}
