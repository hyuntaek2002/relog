import { estimateTokens } from './chatgpt.ts'
import type { Conversation, Turn } from './types.ts'

// Claude Code 세션 기록(~/.claude/projects/<프로젝트>/<세션>.jsonl). 줄마다 JSON 하나.
// 실측(2026-11-10, 데스크톱 2.1.x): type=user 줄에 사람 입력이 들어가지만 도구 결과(tool_result)·시스템 주입(isMeta,
// promptSource=system, origin.kind=task-notification)·하위 에이전트(isSidechain)도 같은 type이라 걸러야 한다.
// 답변은 type=assistant 줄이 블록(text/thinking/tool_use) 단위로 쪼개져 오므로 연속된 text 블록을 한 턴으로 합친다.
interface RawLine {
  type?: string
  uuid?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  gitBranch?: string
  isMeta?: boolean
  isSidechain?: boolean
  promptSource?: string
  origin?: { kind?: string }
  customTitle?: string
  message?: { role?: string; content?: string | { type?: string; text?: string; name?: string; input?: { skill?: string } }[] }
}

// 설치 플러그인 흔적 1: 세션 앞부분 attachment/api-request-blob 줄에 "사용 가능 스킬 목록"(- 플러그인:스킬: 설명)이 들어 있다.
// JSON 안이라 줄바꿈이 \n 두 글자로 들어 있어 원문 줄에 바로 정규식을 건다. anthropic-skills는 기본 내장이라 뺀다.
const SKILL_LIST_RE = /\\n- ([a-z0-9][a-z0-9-]*):[a-z0-9-]+:/g
const BUILTIN_PLUGIN = new Set(['anthropic-skills'])

// 사람이 친 글이 아닌 래퍼 태그. 통째로 이것뿐이면 버리고, 섞여 있으면 태그 부분만 뗀다.
const WRAPPER = /<(local-command-[a-z]+|command-name|command-message|command-args|task-notification|system-reminder|ide_[a-z_]+)>[\s\S]*?<\/\1>/g
const PASTE = /<\/?pasted_content[^>]*>/g

const toMs = (iso?: string) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? null : t }
const baseName = (p?: string) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p : '')

function userText(c: RawLine['message']): { text: string; image: boolean } {
  const content = c?.content
  let raw = ''
  let image = false
  if (typeof content === 'string') raw = content
  else if (Array.isArray(content)) {
    raw = content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text!).join('\n')
    image = content.some((b) => b.type === 'image')
  }
  return { text: raw.replace(WRAPPER, '').replace(PASTE, '').trim(), image }
}

export class ClaudeCodeSessionBuilder {
  private turns: Turn[] = []
  private tools = new Set<string>()
  private plugins = new Set<string>()
  private sessionId = ''
  private cwd = ''
  private title = ''
  private firstAt: number | null = null
  private pendingAssistant: { texts: string[]; at: number | null; id: string } | null = null
  private fallbackId: string
  constructor(fallbackId: string) { this.fallbackId = fallbackId }

  private flushAssistant() {
    const p = this.pendingAssistant
    if (!p) return
    this.pendingAssistant = null
    const text = p.texts.join('\n').trim()
    if (!text) return
    this.turns.push({ idx: this.turns.length, role: 'assistant', text, createdAt: p.at, messageId: p.id, tokenEstimate: estimateTokens(text), hasAttachment: false })
  }

  pushLine(line: string) {
    if (!line.trim()) return
    if (line.includes('skills are available')) for (const m of line.matchAll(SKILL_LIST_RE)) if (!BUILTIN_PLUGIN.has(m[1])) this.plugins.add(m[1])
    let o: RawLine
    try { o = JSON.parse(line) } catch { return }
    if (o.type === 'custom-title' && o.customTitle) { this.title = o.customTitle; return }
    if (o.type !== 'user' && o.type !== 'assistant') return
    if (!this.sessionId && o.sessionId) this.sessionId = o.sessionId
    if (!this.cwd && o.cwd) this.cwd = o.cwd
    const at = toMs(o.timestamp)
    if (at != null && (this.firstAt == null || at < this.firstAt)) this.firstAt = at
    const content = o.message?.content
    if (o.type === 'assistant') {
      if (!Array.isArray(content)) return
      for (const b of content) if (b.type === 'tool_use' && b.name) {
        this.tools.add(b.name)
        // 설치 플러그인 흔적 2: Skill 호출의 "플러그인:스킬" 접두어. 접두어 없는 호출(artifact-design, claude-api 등)은 내장 스킬이라 세지 않는다
        if (b.name === 'Skill' && typeof b.input?.skill === 'string' && b.input.skill.includes(':')) { const p = b.input.skill.split(':')[0].toLowerCase(); if (!BUILTIN_PLUGIN.has(p)) this.plugins.add(p) }
      }
      const texts = content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text!.trim()).filter(Boolean)
      if (texts.length === 0) return
      if (!this.pendingAssistant) this.pendingAssistant = { texts: [], at, id: o.uuid ?? `${this.fallbackId}:a${this.turns.length}` }
      this.pendingAssistant.texts.push(...texts)
      return
    }
    // user 줄: 사람 입력만
    if (o.isMeta || o.isSidechain || o.promptSource === 'system' || (o.origin?.kind && o.origin.kind !== 'human')) return
    const { text, image } = userText(o.message)
    if (!text) return
    this.flushAssistant()
    this.turns.push({ idx: this.turns.length, role: 'user', text, createdAt: at, messageId: o.uuid ?? `${this.fallbackId}:u${this.turns.length}`, tokenEstimate: estimateTokens(text), hasAttachment: image })
  }

  /** 사람 입력이 하나도 없으면 null(하위 에이전트 기록 등) */
  finish(): Conversation | null {
    this.flushAssistant()
    if (!this.turns.some((t) => t.role === 'user')) return null
    const id = this.sessionId || this.fallbackId
    return {
      id,
      platform: 'claude',
      client: 'code',
      title: this.title || (this.cwd ? `${baseName(this.cwd)} (Claude Code)` : 'Claude Code'),
      createdAt: this.firstAt,
      turns: this.turns,
      toolNames: [...this.tools],
      pluginNames: [...this.plugins].sort(),
    }
  }
}

// 세션을 이어 가거나 갈라내면 새 sessionId 파일에 앞 메시지(같은 uuid)가 복사된다(실측: 두 세션이 내 메시지 34개 공유).
// 같은 messageId는 턴이 더 많은 세션에만 남기고 나머지에서 뺀다. 사람 입력이 남지 않은 세션은 버린다.
export function dedupeForkedSessions(convs: Conversation[]): Conversation[] {
  const owner = new Map<string, Conversation>()
  for (const c of convs) {
    if (c.client !== 'code') continue
    for (const t of c.turns) if (t.role === 'user') { const o = owner.get(t.messageId); if (!o || o.turns.length < c.turns.length) owner.set(t.messageId, c) }
  }
  return convs
    .map((c) => {
      if (c.client !== 'code') return c
      const turns = c.turns.filter((t) => t.role !== 'user' || owner.get(t.messageId) === c)
      return turns.length === c.turns.length ? c : { ...c, turns: turns.map((t, idx) => ({ ...t, idx })) }
    })
    .filter((c) => c.client !== 'code' || c.turns.some((t) => t.role === 'user'))
}

export function parseClaudeCodeSession(text: string, fileName: string): Conversation | null {
  const b = new ClaudeCodeSessionBuilder(fileName.replace(/^.*[\\/]/, '').replace(/\.jsonl$/i, ''))
  for (const line of text.split('\n')) b.pushLine(line)
  return b.finish()
}
