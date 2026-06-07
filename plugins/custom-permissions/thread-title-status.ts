import type { PluginAPI, PluginThread, ThreadID } from '@ampcode/plugin'

export const THREAD_TITLE_STATUSES = {
	permissions: { id: 'permissions', prefix: '⚠️', priority: 100 },
	needsUser: { id: 'needs-user', prefix: '🙋', priority: 50 },
} as const

export type ThreadTitleStatusID = (typeof THREAD_TITLE_STATUSES)[keyof typeof THREAD_TITLE_STATUSES]['id']

const STATUS_DEFINITIONS = Object.values(THREAD_TITLE_STATUSES)
const STATUS_PREFIXES = STATUS_DEFINITIONS.map((status) => status.prefix)

interface ThreadTitleState {
	activeCounts: Map<ThreadTitleStatusID, number>
	queue: Promise<void>
}

export class ThreadTitleStatusManager {
	private readonly states = new Map<string, ThreadTitleState>()

	constructor(private readonly amp: PluginAPI) {}

	set(thread: PluginThread, threadID: ThreadID, statusID: ThreadTitleStatusID): void {
		const state = this.getState(threadID)
		state.activeCounts.set(statusID, (state.activeCounts.get(statusID) ?? 0) + 1)
		this.enqueue(threadID, state, async () => {
			await this.apply(thread, threadID, state)
		})
	}

	clear(thread: PluginThread, threadID: ThreadID, statusID: ThreadTitleStatusID): void {
		const key = threadID.toString()
		const state = this.states.get(key)
		if (!state) {
			return
		}
		const count = state.activeCounts.get(statusID) ?? 0
		if (count > 1) {
			state.activeCounts.set(statusID, count - 1)
		} else {
			state.activeCounts.delete(statusID)
		}
		this.enqueue(threadID, state, async () => {
			await this.apply(thread, threadID, state)
			if (state.activeCounts.size === 0 && this.states.get(key) === state) {
				this.states.delete(key)
			}
		})
	}

	private getState(threadID: ThreadID): ThreadTitleState {
		const key = threadID.toString()
		const existing = this.states.get(key)
		if (existing) {
			return existing
		}
		const state: ThreadTitleState = { activeCounts: new Map(), queue: Promise.resolve() }
		this.states.set(key, state)
		return state
	}

	private enqueue(threadID: ThreadID, state: ThreadTitleState, operation: () => Promise<void>): void {
		state.queue = state.queue.then(operation).catch((error) => {
			this.amp.logger.log(`Thread title status update failed for ${threadID}: ${error instanceof Error ? error.message : String(error)}`)
		})
	}

	private async apply(thread: PluginThread, threadID: ThreadID, state: ThreadTitleState): Promise<void> {
		const title = await getThreadTitle(thread)
		if (!title) {
			return
		}

		const titleWithoutStatus = stripKnownTitleStatuses(title)
		const activeStatus = highestPriorityStatus(state.activeCounts)
		const nextTitle = activeStatus ? `${activeStatus.prefix} ${titleWithoutStatus}` : titleWithoutStatus
		if (title !== nextTitle) {
			await renameThread(this.amp, threadID, nextTitle)
		}
	}
}

function highestPriorityStatus(activeCounts: Map<ThreadTitleStatusID, number>) {
	return STATUS_DEFINITIONS
		.filter((status) => (activeCounts.get(status.id) ?? 0) > 0)
		.sort((left, right) => right.priority - left.priority)[0]
}

async function getThreadTitle(thread: PluginThread): Promise<string | null> {
	try {
		return await thread.title.get()
	} catch {
		return null
	}
}

export function stripKnownTitleStatuses(title: string): string {
	let stripped = title.trimStart()
	let changed = true
	while (changed) {
		changed = false
		for (const prefix of STATUS_PREFIXES) {
			if (stripped.startsWith(prefix)) {
				stripped = stripped.slice(prefix.length).trimStart()
				changed = true
			}
		}
	}
	return stripped
}

async function renameThread(amp: PluginAPI, threadID: ThreadID, title: string): Promise<void> {
	try {
		await amp.$`env AMP_SKIP_UPDATE_CHECK=1 amp --no-notifications --no-color --no-ide --no-jetbrains threads rename ${threadID} ${title}`
	} catch (error) {
		amp.logger.log(`Failed to rename thread ${threadID}: ${error instanceof Error ? error.message : String(error)}`)
	}
}
