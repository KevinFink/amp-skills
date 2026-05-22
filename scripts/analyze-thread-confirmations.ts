#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { decide, type Action, type Rule } from '../plugins/custom-permissions/custom-permissions'
import { evaluateShellCommand } from '../plugins/custom-permissions/tighteners'

interface ToolUse {
	id: string
	name: string
	type: 'tool_use'
	input?: Record<string, unknown>
	complete?: boolean
	blockState?: string
}

interface ToolResult {
	type: 'tool_result'
	toolUseID: string
	run?: {
		status?: string
		result?: {
			exitCode?: number
			output?: string
			content?: Array<{ type?: string; text?: string }>
		}
	}
}

interface Classification {
	action: Action
	source: 'custom' | 'user' | 'builtin' | 'default'
	reason: string
	rule: Rule | null
	tightened: boolean
}

interface Finding {
	index: number
	id: string
	tool: string
	command?: string
	workdir?: string
	reason: string
	source: Classification['source']
	action: Action
	tightened: boolean
	outcome: string
	exitCode?: number
	outputPreview?: string
}

const usage = `Usage: bun run scripts/analyze-thread-confirmations.ts <thread-id-or-url> [--json] [--include-rejected]

Exports the Amp thread, replays each tool call through this repo's custom
permission rules, and prints tool calls that would require user confirmation.

Options:
  --json              Print machine-readable JSON.
  --include-rejected  Include calls that would be rejected without prompting.
  --help             Show this help.
`

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
	console.log(usage)
	process.exit(0)
}

const threadArg = args.find((arg) => !arg.startsWith('-'))
if (!threadArg) {
	console.error(usage)
	process.exit(1)
}

const printJson = args.includes('--json')
const includeRejected = args.includes('--include-rejected')
const threadID = normalizeThreadID(threadArg)
const repoRoot = resolve(import.meta.dir, '..')

const userRules = readJson<Rule[]>(resolve(repoRoot, 'settings.json'), (settings) => {
	return ((settings as Record<string, unknown>)['amp.permissions'] as Rule[] | undefined) ?? []
})
const builtinRules = readJson<Rule[]>(resolve(repoRoot, 'plugins/custom-permissions/builtin-rules.json'))
const thread = exportThread(threadID)

const toolUses = collectObjects<ToolUse>(thread, (value): value is ToolUse => {
	return value.type === 'tool_use' && typeof value.id === 'string' && typeof value.name === 'string'
})
const toolResults = collectObjects<ToolResult>(thread, (value): value is ToolResult => {
	return value.type === 'tool_result' && typeof value.toolUseID === 'string'
})
const resultsByID = new Map(toolResults.map((result) => [result.toolUseID, result]))

const findings: Finding[] = []
for (let index = 0; index < toolUses.length; index += 1) {
	const toolUse = toolUses[index]
	const command = shellCommandFromToolUse(toolUse)
	const classification = classifyToolCall(toolUse.name, command)
	const needsUser = classification.action === 'ask' || (includeRejected && classification.action === 'reject')
	if (!needsUser) {
		continue
	}

	const result = resultsByID.get(toolUse.id)
	const runResult = result?.run?.result
	findings.push({
		index: index + 1,
		id: toolUse.id,
		tool: toolUse.name,
		command,
		workdir: typeof toolUse.input?.workdir === 'string' ? toolUse.input.workdir : undefined,
		reason: classification.reason,
		source: classification.source,
		action: classification.action,
		tightened: classification.tightened,
		outcome: outcomeFor(toolUse, result),
		exitCode: runResult?.exitCode,
		outputPreview: preview(runResult?.output ?? textContent(runResult?.content)),
	})
}

if (printJson) {
	console.log(JSON.stringify({ threadID, count: findings.length, findings }, null, 2))
} else {
	printMarkdown(threadID, findings)
}

function classifyToolCall(tool: string, command: string | undefined): Classification {
	let decision = decide(userRules, builtinRules, tool, command)
	let reason = decision.rule
		? `Matched ${decision.source} permission rule with action=${decision.rule.action}.`
		: `No permission rule matched; default action=${decision.action}.`
	let tightened = false

	if (decision.action === 'allow' && command !== undefined && isShellTool(tool)) {
		const tightener = evaluateShellCommand(command)
		if (tightener.kind === 'ask') {
			decision = { action: 'ask', rule: null, source: 'default' }
			reason = tightener.reason
			tightened = true
		}
	}

	return {
		action: decision.action,
		source: decision.source,
		reason,
		rule: decision.rule,
		tightened,
	}
}

function shellCommandFromToolUse(toolUse: ToolUse): string | undefined {
	if (!isShellTool(toolUse.name)) {
		return undefined
	}
	const input = toolUse.input ?? {}
	return typeof input.command === 'string'
		? input.command
		: typeof input.cmd === 'string'
			? input.cmd
			: undefined
}

function isShellTool(tool: string): boolean {
	return tool === 'Bash' || tool === 'shell_command'
}

function exportThread(threadID: string): unknown {
	const result = spawnSync('amp', ['threads', 'export', threadID], {
		encoding: 'utf8',
		maxBuffer: 100 * 1024 * 1024,
	})
	if (result.status !== 0) {
		const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n')
		throw new Error(`amp threads export failed for ${threadID}${details ? `:\n${details}` : ''}`)
	}
	return JSON.parse(result.stdout) as unknown
}

function normalizeThreadID(value: string): string {
	const match = value.match(/T-[0-9a-f-]{36}/i)
	return match ? match[0] : value
}

function readJson<T>(path: string): T
function readJson<T>(path: string, map: (value: unknown) => T): T
function readJson<T>(path: string, map?: (value: unknown) => T): T {
	const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
	return map ? map(parsed) : parsed as T
}

function collectObjects<T>(root: unknown, predicate: (value: Record<string, unknown>) => value is T): T[] {
	const found: T[] = []
	const visit = (value: unknown) => {
		if (Array.isArray(value)) {
			for (const item of value) {
				visit(item)
			}
			return
		}
		if (!value || typeof value !== 'object') {
			return
		}
		const object = value as Record<string, unknown>
		if (predicate(object)) {
			found.push(object)
		}
		for (const child of Object.values(object)) {
			visit(child)
		}
	}
	visit(root)
	return found
}

function outcomeFor(toolUse: ToolUse, result: ToolResult | undefined): string {
	if (!result) {
		return toolUse.complete === false || toolUse.blockState !== 'complete'
			? 'not executed or still pending'
			: 'no result recorded'
	}
	const status = result.run?.status ?? 'unknown'
	const exitCode = result.run?.result?.exitCode
	return exitCode === undefined ? `executed (${status})` : `executed (${status}, exit ${exitCode})`
}

function textContent(content: Array<{ type?: string; text?: string }> | undefined): string | undefined {
	if (!content) {
		return undefined
	}
	return content.map((item) => item.text).filter(Boolean).join('\n')
}

function preview(value: string | undefined): string | undefined {
	if (!value) {
		return undefined
	}
	const compact = value.trim().replace(/\s+/g, ' ')
	return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact
}

function printMarkdown(threadID: string, findings: Finding[]) {
	console.log(`Tool confirmations for ${threadID}`)
	console.log(`Found ${findings.length} tool call${findings.length === 1 ? '' : 's'} requiring user confirmation.\n`)
	for (const finding of findings) {
		console.log(`${finding.index}. ${finding.tool} (${finding.id})`)
		console.log(`   Action: ${finding.action} (${finding.source}${finding.tightened ? ', tightener' : ''})`)
		console.log(`   Reason: ${finding.reason}`)
		console.log(`   Outcome: ${finding.outcome}`)
		if (finding.workdir) {
			console.log(`   Workdir: ${finding.workdir}`)
		}
		if (finding.command) {
			console.log('   Command:')
			for (const line of finding.command.split('\n')) {
				console.log(`     ${line}`)
			}
		}
		if (finding.outputPreview) {
			console.log(`   Output: ${finding.outputPreview}`)
		}
		console.log('')
	}
}
