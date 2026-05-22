import type { PluginAPI } from '@ampcode/plugin'

/** POSIX shell single-quote a string safely. */
function shQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Handoff plugin
 *
 * Adds a command-palette entry that starts a new thread which mentions
 * (hands off from) the current thread, using `amp threads handoff` under
 * the hood. Inspired by Dario's Slack suggestion:
 *   "something a plugin could do (start new thread with a mention of the previous one)"
 *
 * Source: https://github.com/jim-ampcode/handoff-plugin
 * License: MIT (https://github.com/jim-ampcode/handoff-plugin/blob/main/LICENSE)
 */
export default function (amp: PluginAPI) {
	amp.registerCommand(
		'start',
		{
			title: 'Start',
			category: 'Handoff',
			description: 'Start a new thread that mentions (hands off from) the current thread',
		},
		async (ctx) => {
			if (!ctx.thread) {
				await ctx.ui.notify('Handoff: no active thread.')
				return
			}

			const previousID = ctx.thread.id

			const goal = await ctx.ui.input({
				title: 'Handoff goal',
				helpText: `Starting a new thread that references ${previousID}. What should it work on?`,
				submitButtonText: 'Hand off',
			})
			if (!goal || goal.trim() === '') {
				await ctx.ui.notify('Handoff cancelled.')
				return
			}

			amp.logger.log(`handoff: ${previousID} -> goal=${JSON.stringify(goal)}`)

			// `amp threads handoff` has two known server-side issues:
			//   * --goal flag and stdin paths fail asymmetrically depending on
			//     which source thread is used; sometimes one works, sometimes
			//     the other. We try --goal first, then fall back to stdin.
			//   * Some source threads always fail with 400 "text content blocks
			//     must be non-empty" regardless of how the goal is provided
			//     (server can't build a clean handoff payload from them). The
			//     plugin can't fix this; we surface the real error.
			//
			// We also redirect stderr -> stdout via `sh -c` so we can see the
			// real failure reason (Amp's shell wrapper doesn't include stderr
			// on rejection — it only reports "Failed with exit code N").
			const runHandoff = async (mode: 'goal' | 'stdin'): Promise<{
				exitCode: number
				output: string
			}> => {
				const script =
					mode === 'goal'
						? `amp threads handoff ${shQuote(previousID)} --goal ${shQuote(goal)} --print 2>&1`
						: `printf %s ${shQuote(goal)} | amp threads handoff ${shQuote(previousID)} --print 2>&1`
				try {
					const res = await ctx.$`sh -c ${script}`
					return { exitCode: res.exitCode, output: (res.stdout ?? '').toString().trim() }
				} catch (err) {
					const e = err as { stdout?: unknown; exitCode?: number; message?: string }
					const out = (e.stdout ?? '').toString().trim()
					return {
						exitCode: e.exitCode ?? 1,
						output: out || (e.message ?? 'unknown error'),
					}
				}
			}

			let attempt = await runHandoff('goal')
			amp.logger.log(`handoff goal-attempt exit=${attempt.exitCode} out=${attempt.output}`)
			if (attempt.exitCode !== 0) {
				const retry = await runHandoff('stdin')
				amp.logger.log(`handoff stdin-attempt exit=${retry.exitCode} out=${retry.output}`)
				if (retry.exitCode === 0) {
					attempt = retry
				} else {
					// Both failed — surface the more informative output.
					const detail = retry.output || attempt.output
					const friendly = /text content blocks must be non-empty/.test(detail)
						? `Handoff failed: amp rejected source thread ${previousID} (server-side bug — some threads cannot be handed off). Detail: ${detail}`
						: `Handoff failed: ${detail}`
					await ctx.ui.notify(friendly)
					return
				}
			}
			const newID = attempt.output.split(/\s+/).pop() ?? ''

			if (!newID.startsWith('T-')) {
				await ctx.ui.notify(`Handoff produced unexpected output: ${newID}`)
				return
			}

			// Open the new thread in a fresh TUI instance.
			// Preference order:
			//   1. tmux new-window (if running inside tmux)
			//   2. iTerm.app new window (TERM_PROGRAM=iTerm.app)
			//   3. Terminal.app new window (default macOS)
			// `amp threads continue <id>` opens that thread in the TUI.
			const cmd = `amp threads continue ${newID}`
			const tmux = process.env.TMUX
			const termProgram = process.env.TERM_PROGRAM
			try {
				if (tmux) {
					await ctx.$`tmux new-window -n handoff ${cmd}`
				} else if (termProgram === 'iTerm.app') {
					const script = `tell application "iTerm"
						create window with default profile command "${cmd}"
					end tell`
					await ctx.$`osascript -e ${script}`
				} else {
					const script = `tell application "Terminal"
						activate
						do script "${cmd}"
					end tell`
					await ctx.$`osascript -e ${script}`
				}
				await ctx.ui.notify(`Handoff thread created: ${newID} (opened in new terminal)`)
			} catch (err) {
				// Fall back to the web URL if we can't spawn a terminal.
				amp.logger.log(`handoff: terminal spawn failed: ${(err as Error).message}`)
				const url = new URL(`/threads/${newID}`, ctx.system.ampURL).toString()
				await ctx.ui.notify(
					`Handoff thread ${newID} created. Could not open new terminal; opening in browser.`,
				)
				await ctx.system.open(url)
			}
		},
	)
}
