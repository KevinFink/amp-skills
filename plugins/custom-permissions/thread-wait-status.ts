import type { PluginAPI, PluginThread, ThreadID, ThreadMessage } from '@ampcode/plugin'
import { THREAD_TITLE_STATUSES, type ThreadTitleStatusManager } from './thread-title-status'

const NEEDS_USER_ACTION_PATTERNS = [
	/\bnot\s+(?:committed|pushed|landed)\b/i,
	/\bwaiting\s+(?:for|on)\b/i,
	/\bplease\s+confirm\b/i,
	/\bconfirm\s+(?:before|if|whether|that)\b/i,
	/\bapproval\b/i,
	/\binput\b/i,
	/\bresponse\b/i,
	/\bsay\s+the\s+word\b/i,
	/\bslack\s+notification\s+skipped\b/i,
	/\bSLACK_WEBHOOK_URL\b/,
]

const DELAYED_THREAD_CHECK_MS = 2_000

export function installThreadWaitStatus(amp: PluginAPI, titleStatuses: ThreadTitleStatusManager): void {
	const delayedChecks = new Map<string, ReturnType<typeof setTimeout>>()

	amp.on('session.start', (_event, ctx) => {
		if (ctx.thread) {
			void updateThreadWaitStatus(ctx.thread, ctx.thread.id, titleStatuses, [])
		}
	})

	amp.on('agent.start', (_event, ctx) => {
		if (ctx.thread) {
			const threadKey = ctx.thread.id.toString()
			const delayedCheck = delayedChecks.get(threadKey)
			if (delayedCheck) {
				clearTimeout(delayedCheck)
				delayedChecks.delete(threadKey)
			}
			titleStatuses.clear(ctx.thread, ctx.thread.id, THREAD_TITLE_STATUSES.needsUser.id)
		}
	})

	amp.on('agent.end', async (event, ctx) => {
		if (!ctx.thread) {
			return
		}

		const thread = ctx.thread
		const threadID = event.thread.id
		const detected = await updateThreadWaitStatus(thread, threadID, titleStatuses, event.messages)
		if (detected) {
			return
		}

		const threadKey = threadID.toString()
		const delayedCheck = setTimeout(() => {
			delayedChecks.delete(threadKey)
			void updateThreadWaitStatus(thread, threadID, titleStatuses, [])
		}, DELAYED_THREAD_CHECK_MS)
		delayedChecks.set(threadKey, delayedCheck)
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

async function updateThreadWaitStatus(
	thread: PluginThread,
	threadID: ThreadID,
	titleStatuses: ThreadTitleStatusManager,
	eventMessages: ThreadMessage[],
): Promise<boolean> {
	const candidateTexts = [lastAssistantText(eventMessages), lastAssistantText(await recentThreadMessages(thread))]
	if (candidateTexts.some((text) => text && textNeedsUserAction(text))) {
		titleStatuses.setActive(thread, threadID, THREAD_TITLE_STATUSES.needsUser.id)
		return true
	}

	titleStatuses.clear(thread, threadID, THREAD_TITLE_STATUSES.needsUser.id)
	return false
}

async function recentThreadMessages(thread: { messages(options?: { from?: 'start' | 'end'; limit?: number }): Promise<ThreadMessage[]> }): Promise<ThreadMessage[]> {
	try {
		return await thread.messages({ from: 'end', limit: 10 })
	} catch {
		return []
	}
}
