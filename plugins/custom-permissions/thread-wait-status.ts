import type { PluginAPI, ThreadMessage } from '@ampcode/plugin'
import { THREAD_TITLE_STATUSES, type ThreadTitleStatusManager } from './thread-title-status'

const NEEDS_USER_ACTION_PATTERNS = [
	/\bnot\s+(?:committed|pushed|landed)\b/i,
	/\bwaiting\s+(?:for|on)\b/i,
	/\bplease\s+confirm\b/i,
	/\bconfirm\s+(?:before|if|whether|that)\b/i,
	/\bapproval\b/i,
	/\binput\b/i,
	/\bresponse\b/i,
	/\bslack\s+notification\s+skipped\b/i,
	/\bSLACK_WEBHOOK_URL\b/,
]

export function installThreadWaitStatus(amp: PluginAPI, titleStatuses: ThreadTitleStatusManager): void {
	amp.on('agent.start', (_event, ctx) => {
		if (ctx.thread) {
			titleStatuses.clear(ctx.thread, ctx.thread.id, THREAD_TITLE_STATUSES.needsUser.id)
		}
	})

	amp.on('agent.end', (event, ctx) => {
		if (!ctx.thread) {
			return
		}

		const finalAssistantText = lastAssistantText(event.messages)
		if (finalAssistantText && textNeedsUserAction(finalAssistantText)) {
			titleStatuses.set(ctx.thread, event.thread.id, THREAD_TITLE_STATUSES.needsUser.id)
			return
		}

		titleStatuses.clear(ctx.thread, event.thread.id, THREAD_TITLE_STATUSES.needsUser.id)
	})
}

export function textNeedsUserAction(text: string): boolean {
	return NEEDS_USER_ACTION_PATTERNS.some((pattern) => pattern.test(text))
}

function lastAssistantText(messages: ThreadMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index]
		if (message.role !== 'assistant') {
			continue
		}
		return message.content
			.filter((block) => block.type === 'text')
			.map((block) => block.text)
			.join('\n')
	}
	return ''
}
