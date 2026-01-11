import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const OPENAI_API_URL = process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions"
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini"

const BASE_SYSTEM_PROMPT = `
You are Health Coach, concise and supportive.
- Use Context first; do not hallucinate.
- Be extremely brief: max ~80 words, prefer 3–5 short bullets.
- If data is missing, say so in one line and ask one clear question.
- Surface clear issues first; otherwise keep it friendly and to the point.
- Reply in simple markdown with each bullet on its own line.
`.trim()

const SUGGESTIONS_PROMPT = `
You are Health Coach. Given the context and recent chat, propose 3 short follow-up questions the user could ask next.
- Keep each suggestion on its own line, no bullets or numbering needed.
- Focus on actionable, relevant questions about the provided data (records, sleep, vitals).
- Be concise and avoid fluff.
`.trim()

type ChatMessage = { role: "system" | "user" | "assistant"; content: string }

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 500 })
  }

  let body: { messages?: ChatMessage[]; context?: string; mode?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const contextBlock = body.context?.trim()
  const baseMessages = (body.messages || []).filter((m) => m?.content && m?.role) as ChatMessage[]
  const messages: ChatMessage[] = []
  const isSuggestions = body.mode === "suggestions"
  messages.push({ role: "system", content: isSuggestions ? SUGGESTIONS_PROMPT : BASE_SYSTEM_PROMPT })
  if (contextBlock) {
    messages.push({ role: "system", content: `Context:\n${contextBlock}` })
  }
  messages.push(...baseMessages)
  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided." }, { status: 400 })
  }

  // Basic guardrails
  if (messages.length > 100) {
    return NextResponse.json({ error: "Too many messages." }, { status: 400 })
  }
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0)
  if (totalChars > 16000) {
    return NextResponse.json({ error: "Messages too long." }, { status: 400 })
  }

  const payload = {
    model: OPENAI_MODEL,
    messages,
  }

  try {
    const upstream = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    const text = await upstream.text()
    if (!upstream.ok) {
      let detail: any = null
      try {
        detail = JSON.parse(text)
      } catch {}
      const message = detail?.error?.message || `OpenAI error (${upstream.status})`
      return NextResponse.json({ error: message }, { status: upstream.status })
    }

    const json = JSON.parse(text)
    const choice = json.choices?.[0]?.message?.content ?? ""
    return NextResponse.json({ reply: choice })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unexpected error contacting OpenAI." }, { status: 500 })
  }
}
