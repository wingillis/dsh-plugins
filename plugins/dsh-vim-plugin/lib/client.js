window.__ModuleLoader__.load({
	id: "dsh-vim-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/vim/machine.ts
		/** Fresh machine state: insert mode (the composer's native posture), empty everything. */
		const INITIAL_VIM_STATE = {
			mode: "insert",
			visual: null,
			pendingOperator: null,
			count: null,
			pendingG: false,
			pendingFind: null,
			pendingReplace: false,
			lastFind: null,
			register: {
				text: "",
				linewise: false
			},
			wantColumn: null
		};
		/** The empty-register constant. */
		/** Word character class (letters, numbers, underscore). */
		const WORD_RE = /[\p{L}\p{N}_]/u;
		/** The detect-projection chip placeholder is a punctuation-class atom. */
		const CHIP = "￼";
		function classOf(text, at) {
			const ch = text[at] ?? "";
			if (ch === "" || /\s/u.test(ch)) return "blank";
			if (ch === CHIP) return "punct";
			return WORD_RE.test(ch) ? "word" : "punct";
		}
		/** Ordered line-start offsets of a document (starts[0] === 0). */
		function lineStarts(text) {
			const starts = [0];
			for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
			return starts;
		}
		/** The line index one offset lives on. */
		function lineOf(starts, at) {
			let lo = 0;
			let hi = starts.length - 1;
			while (lo < hi) {
				const mid = lo + hi + 1 >> 1;
				if ((starts[mid] ?? 0) <= at) lo = mid;
				else hi = mid - 1;
			}
			return lo;
		}
		/** One-line [start, end) window; end excludes the terminating newline. */
		function lineSpan(text, starts, line) {
			const start = starts[line] ?? 0;
			const next = starts[line + 1];
			const rawEnd = next === void 0 ? text.length : next - 1;
			return {
				start,
				end: Math.max(start, Math.min(rawEnd, text.length))
			};
		}
		/**
		* Simulation buffer: applies operations to a local text copy so subsequent
		* operations compute against post-edit coordinates, and records the emitted
		* primitives in application order.
		*/
		var Sim = class {
			ops = [];
			text;
			constructor(text) {
				this.text = text;
			}
			/** Replace a span with newline-free text. */
			replace(start, end, text) {
				const from = Math.max(0, Math.min(start, this.text.length));
				const to = Math.max(from, Math.min(end, this.text.length));
				this.ops.push({
					type: "replace",
					start: from,
					end: to,
					text
				});
				this.text = this.text.slice(0, from) + text + this.text.slice(to);
			}
			/** Insert a line break (document split) at one offset. */
			break(at) {
				const atClamped = Math.max(0, Math.min(at, this.text.length));
				this.ops.push({
					type: "break",
					at: atClamped
				});
				this.text = this.text.slice(0, atClamped) + "\n" + this.text.slice(atClamped);
			}
			move(to) {
				this.ops.push({
					type: "move",
					to: Math.max(0, Math.min(to, this.text.length))
				});
			}
			select(start, end) {
				const from = Math.max(0, Math.min(start, this.text.length));
				const to = Math.max(0, Math.min(end, this.text.length));
				this.ops.push({
					type: "select",
					start: Math.min(from, to),
					end: Math.max(from, to)
				});
			}
			undo() {
				this.ops.push({ type: "undo" });
			}
		};
		/** Clamp one offset into one line's span. */
		function clampToLine(at, line) {
			return Math.max(line.start, Math.min(at, line.end));
		}
		/** First non-blank offset of one line (its end when the line is all blank). */
		function firstNonBlank(text, line) {
			for (let i = line.start; i < line.end; i += 1) if (classOf(text, i) !== "blank") return i;
			return line.end;
		}
		/**
		* Splice one paste of `text` at `cursor` and answer the offset just past the
		* spliced content. Text carrying newlines (a register filled by `dw` across a
		* line end) rides break/replace primitive pairs — the face never receives a
		* literal newline.
		*/
		function splicePaste(sim, cursor, text) {
			const parts = text.split("\n");
			for (let i = 0; i < parts.length; i += 1) {
				const part = parts[i] ?? "";
				if (part !== "") sim.replace(cursor, cursor, part);
				cursor += part.length;
				if (i < parts.length - 1) {
					sim.break(cursor);
					cursor += 1;
				}
			}
			return cursor;
		}
		/**
		* Forward word-start motion (`w`): leave the current class run, skip blanks,
		* land on the next run's head (or end of document).
		*/
		function wordForward(text, from) {
			let i = from;
			const cls = classOf(text, i);
			if (cls !== "blank") while (i < text.length && classOf(text, i) === cls) i += 1;
			while (i < text.length && classOf(text, i) === "blank") i += 1;
			return i;
		}
		/**
		* Backward word-start motion (`b`): skip blanks backward, then the run of
		* the class met, landing on its head.
		*/
		function wordBackward(text, from) {
			let i = from;
			while (i > 0 && classOf(text, i - 1) === "blank") i -= 1;
			if (i === 0) return 0;
			const cls = classOf(text, i - 1);
			while (i > 0 && classOf(text, i - 1) === cls) i -= 1;
			return i;
		}
		/**
		* Forward word-end motion (`e`): advance out of blanks, then to the tail of
		* the run found.
		*/
		function wordEnd(text, from) {
			let i = from + 1;
			while (i < text.length && classOf(text, i) === "blank") i += 1;
			if (i >= text.length) return Math.max(from, text.length - 1);
			const cls = classOf(text, i);
			while (i + 1 < text.length && classOf(text, i + 1) === cls) i += 1;
			return i;
		}
		/** Find-motion char position: N-th occurrence of `ch` on the caret's line (null when absent). */
		function findInLine(text, caret, kind, ch, count) {
			const starts = lineStarts(text);
			const line = lineSpan(text, starts, lineOf(starts, caret));
			let hits = 0;
			if (kind === "f" || kind === "t") {
				for (let i = caret + 1; i < line.end; i += 1) if (text[i] === ch) {
					hits += 1;
					if (hits >= count) return i;
				}
				return null;
			}
			for (let i = caret - 1; i >= line.start; i -= 1) if (text[i] === ch) {
				hits += 1;
				if (hits >= count) return i;
			}
			return null;
		}
		/** Index of one offset's display row within a visual-line map (row starts sorted, [0] === 0). */
		function visualRowOf(vlines, at) {
			let lo = 0;
			let hi = vlines.length - 1;
			while (lo < hi) {
				const mid = lo + hi + 1 >> 1;
				if ((vlines[mid] ?? 0) <= at) lo = mid;
				else hi = mid - 1;
			}
			return lo;
		}
		/**
		* The `gj`/`gk` motion: move by display rows over the controller-measured
		* visual-line map, riding the caret's screen column (its distance from the
		* current row's start — never the logical wantColumn, which counts from the
		* logical line start and would land wrong on wrapped rows). The caret clamps
		* to the logical line's end, never past it. Vim treats these as exclusive
		* charwise motions for operators — unlike the linewise `j`/`k`. Without a
		* map the motion degrades to logical `j`/`k` (identical on unwrapped
		* content).
		* @param dir signed row count (already count-multiplied; negative = up).
		*/
		function visualRowMotion(doc, caret, dir) {
			const vlines = doc.vlines ?? null;
			if (vlines === null || vlines.length === 0 || (vlines[0] ?? -1) !== 0) return resolveMotion(doc.text, caret, dir > 0 ? "j" : "k", Math.abs(dir), null);
			const text = doc.text;
			const row = visualRowOf(vlines, caret);
			const target = Math.max(0, Math.min(row + dir, vlines.length - 1));
			const starts = lineStarts(text);
			const column = caret - (vlines[row] ?? 0);
			const rowStart = vlines[target] ?? 0;
			const targetLine = lineSpan(text, starts, lineOf(starts, Math.min(rowStart, text.length)));
			const land = clampToLine(rowStart + column, targetLine);
			return {
				from: caret,
				to: land,
				land,
				vertical: false,
				want: "clear"
			};
		}
		/** Invert a find kind (`,` repeats the last find in the opposite direction). */
		function invertFind(kind) {
			switch (kind) {
				case "f": return "F";
				case "F": return "f";
				case "t": return "T";
				case "T": return "t";
			}
		}
		/**
		* Resolve one motion key against a document state.
		* @returns the target, or null when the key is not a motion (or the find target is absent).
		*/
		function resolveMotion(text, caret, key, count, find) {
			const starts = lineStarts(text);
			const lineIndex = lineOf(starts, caret);
			const line = lineSpan(text, starts, lineIndex);
			switch (key) {
				case "h":
				case "ArrowLeft":
				case "Backspace": {
					const from = Math.max(line.start, caret - count);
					return {
						from,
						to: caret,
						land: from,
						vertical: false,
						want: "clear"
					};
				}
				case "l":
				case "ArrowRight":
				case " ": {
					const to = Math.min(line.end, caret + count);
					return {
						from: caret,
						to,
						land: to,
						vertical: false,
						want: "clear"
					};
				}
				case "j":
				case "ArrowDown": return {
					from: caret,
					targetLine: Math.min(lineIndex + count, starts.length - 1),
					vertical: true,
					want: "preserve"
				};
				case "k":
				case "ArrowUp": return {
					from: caret,
					targetLine: Math.max(lineIndex - count, 0),
					vertical: true,
					want: "preserve"
				};
				case "0":
				case "Home": return {
					from: line.start,
					to: caret,
					land: line.start,
					vertical: false,
					want: "clear"
				};
				case "^": {
					const from = firstNonBlank(text, line);
					return {
						from,
						to: caret,
						land: from,
						vertical: false,
						want: "clear"
					};
				}
				case "$":
				case "End": {
					const target = lineSpan(text, starts, Math.min(lineIndex + count - 1, starts.length - 1));
					return {
						from: caret,
						to: target.end,
						land: Math.max(target.start, target.end - 1),
						vertical: false,
						want: "clear"
					};
				}
				case "w": {
					let to = caret;
					for (let n = 0; n < count; n += 1) to = wordForward(text, to);
					return {
						from: caret,
						to,
						land: to,
						vertical: false,
						want: "clear"
					};
				}
				case "b": {
					let to = caret;
					for (let n = 0; n < count; n += 1) to = wordBackward(text, to);
					return {
						from: to,
						to: caret,
						land: to,
						vertical: false,
						want: "clear"
					};
				}
				case "e": {
					let land = caret;
					for (let n = 0; n < count; n += 1) land = wordEnd(text, land);
					return {
						from: caret,
						to: land + 1,
						land,
						vertical: false,
						want: "clear"
					};
				}
				case "G": {
					const target = count === 1 ? starts.length - 1 : Math.min(count - 1, starts.length - 1);
					return {
						from: caret,
						targetLine: target,
						land: firstNonBlank(text, lineSpan(text, starts, target)),
						vertical: true,
						want: "set"
					};
				}
				case "gg": {
					const target = Math.max(0, Math.min(count - 1, starts.length - 1));
					return {
						from: caret,
						targetLine: target,
						land: firstNonBlank(text, lineSpan(text, starts, target)),
						vertical: true,
						want: "set"
					};
				}
				case "f":
				case "F":
				case "t":
				case "T":
				case ";":
				case ",": {
					if (find === null) return null;
					const at = findInLine(text, caret, find.kind, find.char, count);
					if (at === null) return {
						from: caret,
						to: caret,
						land: caret,
						vertical: false,
						want: "clear"
					};
					switch (find.kind) {
						case "f": return {
							from: caret,
							to: at + 1,
							land: at,
							vertical: false,
							want: "clear"
						};
						case "F": return {
							from: at,
							to: caret,
							land: at,
							vertical: false,
							want: "clear"
						};
						case "t": return {
							from: caret,
							to: at,
							land: at - 1,
							vertical: false,
							want: "clear"
						};
						case "T": return {
							from: at + 1,
							to: caret,
							land: at + 1,
							vertical: false,
							want: "clear"
						};
					}
				}
				default: return null;
			}
		}
		/** Column-preserving landing offset for a vertical motion. */
		function verticalLanding(text, targetLine, column) {
			const target = lineSpan(text, lineStarts(text), targetLine);
			return clampToLine(target.start + column, target);
		}
		/** Landing offset for a motion used as a plain caret move. */
		function landingOf(text, caret, motion, wantColumn) {
			if (motion.land !== void 0) return motion.land;
			if (motion.targetLine !== void 0) {
				const col = wantColumn ?? caret - lineSpan(text, lineStarts(text), lineOf(lineStarts(text), caret)).start;
				return verticalLanding(text, motion.targetLine, col);
			}
			/* v8 ignore next 2 -- every motion resolves land or targetLine; this
			return names the type's floor for a motion that supplies neither. */
			return motion.to ?? caret;
		}
		/** Reset every pending prefix (operator, count, g/find/replace waits). */
		function clearPending(state) {
			return {
				...state,
				pendingOperator: null,
				count: null,
				pendingG: false,
				pendingFind: null,
				pendingReplace: false
			};
		}
		/** Whether the key event carries no browser modifiers. */
		function plain(ev) {
			return !ev.ctrl && !ev.meta && !ev.alt;
		}
		/** Modifier-only keydowns (Shift and friends) never reach any binding. */
		function isModifierOnly(key) {
			return [
				"Shift",
				"Control",
				"Alt",
				"Meta",
				"CapsLock",
				"NumLock",
				"ScrollLock",
				"Dead",
				"Compose"
			].includes(key);
		}
		/** Keys that always pass in NORMAL mode (browser-owned: focus traversal, function keys). */
		function passesNormal(ev) {
			if (isModifierOnly(ev.key)) return true;
			if (/^F(?:1[0-2]|[1-9])$/u.test(ev.key)) return true;
			if (ev.key === "Tab") return true;
			return ev.ctrl || ev.meta;
		}
		/** INSERT-mode step: only Escape is owned. */
		function stepInsert(state, doc, ev) {
			if (ev.key !== "Escape" || !plain(ev)) return {
				state,
				consume: false,
				ops: []
			};
			const line = lineSpan(doc.text, lineStarts(doc.text), lineOf(lineStarts(doc.text), doc.caret));
			const to = doc.caret > line.start ? doc.caret - 1 : doc.caret;
			return {
				state: {
					...clearPending(state),
					mode: "normal",
					wantColumn: null
				},
				consume: true,
				ops: [{
					type: "move",
					to
				}]
			};
		}
		/**
		* Fold one key event against the document.
		* @param state - machine state before the key.
		* @param doc - the document snapshot.
		* @param ev - the normalized key.
		* @returns the next state, consumption verdict, and ordered operations.
		*/
		function step(state, doc, ev) {
			if (state.mode === "insert") return stepInsert(state, doc, ev);
			if (!plain(ev) || passesNormal(ev)) return {
				state: clearPending(state),
				consume: false,
				ops: []
			};
			if (state.visual !== null) return stepVisual(state, state.visual, doc, ev);
			return stepNormal(state, doc, ev);
		}
		function stepNormal(state, doc, ev) {
			const sim = new Sim(doc.text);
			const count = state.count ?? 1;
			const caret = doc.caret;
			const starts = lineStarts(doc.text);
			const line = lineSpan(doc.text, starts, lineOf(starts, caret));
			const col = caret - line.start;
			if (state.pendingFind !== null) {
				if (ev.key.length !== 1) return {
					state: clearPending(state),
					consume: true,
					ops: []
				};
				const find = {
					kind: state.pendingFind,
					char: ev.key
				};
				const motion = resolveMotion(doc.text, caret, find.kind, count, find);
				const landed = motion === null ? caret : landingOf(doc.text, caret, motion, state.wantColumn);
				if (state.pendingOperator !== null) return applyOperatorMotion(state, sim, caret, state.pendingOperator, motion);
				return {
					state: {
						...clearPending(state),
						lastFind: find,
						wantColumn: motion?.want === "preserve" ? state.wantColumn : null
					},
					consume: true,
					ops: [{
						type: "move",
						to: landed
					}]
				};
			}
			if (state.pendingReplace) {
				if (ev.key.length !== 1) return {
					state: clearPending(state),
					consume: true,
					ops: []
				};
				const end = Math.min(line.end, caret + count);
				if (end > caret) {
					sim.replace(caret, end, ev.key.repeat(end - caret));
					sim.move(end - 1);
				} else sim.move(caret);
				return {
					state: clearPending(state),
					consume: true,
					ops: sim.ops
				};
			}
			if (state.pendingG) {
				if (ev.key === "g") {
					const motion = resolveMotion(doc.text, caret, "gg", count, null);
					if (state.pendingOperator !== null) return applyOperatorMotion(state, sim, caret, state.pendingOperator, motion);
					return finishPlainMotion(state, sim, caret, motion, col, state.wantColumn);
				}
				if (ev.key === "j" || ev.key === "k") {
					const motion = visualRowMotion(doc, caret, ev.key === "j" ? count : -count);
					if (state.pendingOperator !== null) return applyOperatorMotion(state, sim, caret, state.pendingOperator, motion);
					return finishPlainMotion(state, sim, caret, motion, col, state.wantColumn);
				}
				return stepNormal(clearPending(state), doc, ev);
			}
			const nextCount = countDigitOf(state, ev.key);
			if (nextCount !== null) return {
				state: {
					...state,
					count: nextCount
				},
				consume: true,
				ops: []
			};
			if (state.pendingOperator !== null && ev.key === state.pendingOperator) {
				const first = lineOf(starts, caret);
				const last = Math.min(first + count - 1, starts.length - 1);
				return applyLinewise(state, sim, state.pendingOperator, first, last);
			}
			if (state.pendingOperator !== null) {
				const operator = state.pendingOperator;
				const motionKey = operator === "c" && ev.key === "w" && classOf(doc.text, caret) !== "blank" ? "e" : ev.key;
				if (motionKey === "f" || motionKey === "F" || motionKey === "t" || motionKey === "T") return {
					state: {
						...state,
						pendingFind: motionKey
					},
					consume: true,
					ops: []
				};
				if (motionKey === "g") return {
					state: {
						...state,
						pendingG: true
					},
					consume: true,
					ops: []
				};
				const find = findArgumentOf(state, motionKey);
				if ((motionKey === ";" || motionKey === ",") && find === null) return {
					state: clearPending(state),
					consume: true,
					ops: []
				};
				const motion = resolveMotion(doc.text, caret, motionKey, count, find);
				if (motion === null) return {
					state: clearPending(state),
					consume: true,
					ops: []
				};
				return applyOperatorMotion(state, sim, caret, operator, motion);
			}
			if (ev.key === "d" || ev.key === "c" || ev.key === "y") return {
				state: {
					...state,
					pendingOperator: ev.key
				},
				consume: true,
				ops: []
			};
			const wait = startPendingWait(state, ev.key);
			if (wait !== null) return wait;
			if (ev.key === ";" || ev.key === ",") {
				const find = findArgumentOf(state, ev.key);
				if (find === null) return {
					state,
					consume: true,
					ops: []
				};
				return finishPlainMotion(state, sim, caret, resolveMotion(doc.text, caret, ev.key, count, find), col, state.wantColumn);
			}
			const motion = resolveMotion(doc.text, caret, ev.key, count, null);
			if (motion !== null) return finishPlainMotion(state, sim, caret, motion, col, state.wantColumn);
			switch (ev.key) {
				case "r": return {
					state: {
						...state,
						pendingReplace: true
					},
					consume: true,
					ops: []
				};
				case "x":
				case "X":
				case "s": {
					const span = ev.key === "X" ? {
						start: Math.max(line.start, caret - count),
						end: caret
					} : {
						start: caret,
						end: Math.min(line.end, caret + count)
					};
					if (span.end <= span.start) return {
						state: clearPending(state),
						consume: true,
						ops: []
					};
					const deleted = doc.text.slice(span.start, span.end);
					sim.replace(span.start, span.end, "");
					sim.move(span.start);
					if (ev.key === "s") return {
						state: {
							...clearPending(state),
							mode: "insert"
						},
						consume: true,
						ops: sim.ops
					};
					return {
						state: {
							...clearPending(state),
							register: {
								text: deleted,
								linewise: false
							}
						},
						consume: true,
						ops: sim.ops
					};
				}
				case "D":
				case "C": {
					const deleted = doc.text.slice(caret, line.end);
					sim.replace(caret, line.end, "");
					sim.move(caret);
					return ev.key === "D" ? {
						state: {
							...clearPending(state),
							register: {
								text: deleted,
								linewise: false
							}
						},
						consume: true,
						ops: sim.ops
					} : {
						state: {
							...clearPending(state),
							mode: "insert"
						},
						consume: true,
						ops: sim.ops
					};
				}
				case "p":
				case "P": {
					const reg = state.register;
					if (reg.text === "") return {
						state: clearPending(state),
						consume: true,
						ops: []
					};
					if (reg.linewise) {
						const anchor = ev.key === "p" ? line.end : line.start;
						let cursor = anchor;
						for (let n = 0; n < count; n += 1) {
							sim.break(cursor);
							cursor = splicePaste(sim, cursor + 1, reg.text);
						}
						sim.move(anchor + 1);
						return {
							state: clearPending(state),
							consume: true,
							ops: sim.ops
						};
					}
					const at = ev.key === "p" ? Math.min(caret + 1, line.end) : caret;
					const cursor = splicePaste(sim, at, reg.text);
					sim.move(Math.max(at, cursor - 1));
					return {
						state: clearPending(state),
						consume: true,
						ops: sim.ops
					};
				}
				case "o":
				case "O": {
					const at = ev.key === "o" ? line.end : line.start;
					sim.break(at);
					sim.move(ev.key === "o" ? at + 1 : at);
					return {
						state: {
							...clearPending(state),
							mode: "insert",
							wantColumn: null
						},
						consume: true,
						ops: sim.ops
					};
				}
				case "u":
					for (let n = 0; n < count; n += 1) sim.undo();
					return {
						state: clearPending(state),
						consume: true,
						ops: sim.ops
					};
				case "i": return {
					state: {
						...clearPending(state),
						mode: "insert",
						wantColumn: null
					},
					consume: true,
					ops: []
				};
				case "I":
					sim.move(firstNonBlank(doc.text, line));
					return {
						state: {
							...clearPending(state),
							mode: "insert",
							wantColumn: null
						},
						consume: true,
						ops: sim.ops
					};
				case "a":
					sim.move(Math.min(line.end, caret + 1));
					return {
						state: {
							...clearPending(state),
							mode: "insert",
							wantColumn: null
						},
						consume: true,
						ops: sim.ops
					};
				case "A":
					sim.move(line.end);
					return {
						state: {
							...clearPending(state),
							mode: "insert",
							wantColumn: null
						},
						consume: true,
						ops: sim.ops
					};
				case "v":
				case "V": {
					const visual = {
						anchor: caret,
						caret,
						linewise: ev.key === "V"
					};
					selectVisual(sim, visual);
					return {
						state: {
							...clearPending(state),
							visual
						},
						consume: true,
						ops: sim.ops
					};
				}
				default:
					if (ev.key.length === 1) return {
						state: clearPending(state),
						consume: true,
						ops: []
					};
					return {
						state,
						consume: false,
						ops: []
					};
			}
		}
		/**
		* Project one visual selection onto the document as a `select` operation:
		* charwise covers [min(anchor, caret), max(anchor, caret) + 1) — the
		* character under the moving caret is included, matching the block-caret
		* posture — and linewise covers the start of the first addressed line
		* through the end of the last (the terminating newline stays out).
		*/
		function selectVisual(sim, vis) {
			const starts = lineStarts(sim.text);
			if (vis.linewise) {
				const first = Math.min(lineOf(starts, vis.anchor), lineOf(starts, vis.caret));
				const last = Math.max(lineOf(starts, vis.anchor), lineOf(starts, vis.caret));
				const start = starts[first] ?? 0;
				sim.select(start, Math.max(start, lineSpan(sim.text, starts, last).end));
				return;
			}
			const from = Math.min(vis.anchor, vis.caret);
			const to = Math.min(sim.text.length, Math.max(vis.anchor, vis.caret) + 1);
			if (to > from) sim.select(from, to);
		}
		/** Collapse out of visual mode: pendings reset, selection dropped. */
		function dropVisual(state) {
			return {
				...clearPending(state),
				visual: null
			};
		}
		function stepVisual(state, vis, doc, ev) {
			const sim = new Sim(doc.text);
			const count = state.count ?? 1;
			const caret = vis.caret;
			const starts = lineStarts(doc.text);
			const col = caret - lineSpan(doc.text, starts, lineOf(starts, caret)).start;
			if (state.pendingFind !== null) {
				if (ev.key.length !== 1) {
					sim.move(caret);
					return {
						state: dropVisual(state),
						consume: true,
						ops: sim.ops
					};
				}
				const find = {
					kind: state.pendingFind,
					char: ev.key
				};
				const extended = finishVisualMotion(state, vis, sim, caret, resolveMotion(doc.text, caret, find.kind, count, find), col);
				return {
					...extended,
					state: {
						...extended.state,
						lastFind: find
					}
				};
			}
			if (state.pendingG) {
				if (ev.key === "g") return finishVisualMotion(state, vis, sim, caret, resolveMotion(doc.text, caret, "gg", count, null), col);
				if (ev.key === "j" || ev.key === "k") return finishVisualMotion(state, vis, sim, caret, visualRowMotion(doc, caret, ev.key === "j" ? count : -count), col);
				return stepVisual(clearPending(state), vis, doc, ev);
			}
			if (ev.key === "Escape" || ev.key === "v" || ev.key === "V") {
				const linewise = ev.key === "V";
				if (ev.key === "Escape" || vis.linewise === linewise) {
					sim.move(caret);
					return {
						state: dropVisual(state),
						consume: true,
						ops: sim.ops
					};
				}
				const next = {
					...vis,
					linewise
				};
				selectVisual(sim, next);
				return {
					state: {
						...clearPending(state),
						visual: next
					},
					consume: true,
					ops: sim.ops
				};
			}
			const deletes = ev.key === "d" || ev.key === "x" || ev.key === "D";
			const yanks = ev.key === "y" || ev.key === "Y";
			const changes = ev.key === "c" || ev.key === "s" || ev.key === "C";
			if (deletes || yanks || changes) {
				const operator = deletes ? "d" : changes ? "c" : "y";
				const linewise = vis.linewise || ev.key === "D" || ev.key === "Y" || ev.key === "C";
				const anchorLine = lineOf(starts, vis.anchor);
				const caretLine = lineOf(starts, vis.caret);
				const applied = linewise ? applyLinewise(state, sim, operator, Math.min(anchorLine, caretLine), Math.max(anchorLine, caretLine)) : applyCharwise(state, sim, operator, Math.min(vis.anchor, vis.caret), Math.min(doc.text.length, Math.max(vis.anchor, vis.caret) + 1));
				const collapse = linewise ? starts[Math.min(anchorLine, caretLine)] ?? 0 : Math.min(vis.anchor, vis.caret);
				return {
					state: {
						...applied.state,
						visual: null
					},
					consume: true,
					ops: operator === "y" ? [...applied.ops, {
						type: "move",
						to: collapse
					}] : applied.ops
				};
			}
			const nextCount = countDigitOf(state, ev.key);
			if (nextCount !== null) return {
				state: {
					...state,
					count: nextCount
				},
				consume: true,
				ops: []
			};
			const wait = startPendingWait(state, ev.key);
			if (wait !== null) return wait;
			const repeat = visualFindRepeat(state, vis, sim, caret, count, ev.key, col);
			if (repeat !== null) return repeat;
			const motion = resolveMotion(doc.text, caret, ev.key, count, null);
			if (motion !== null) return finishVisualMotion(state, vis, sim, caret, motion, col);
			if (ev.key.length === 1) return {
				state: clearPending(state),
				consume: true,
				ops: []
			};
			return {
				state,
				consume: false,
				ops: []
			};
		}
		/**
		* `;`/`,` inside visual mode: repeat the remembered find as a selection
		* extension (a remembered-find miss consumes the key and keeps the selection).
		* @returns the step, or null when the key repeats nothing (not a repeat key, or no find remembered).
		*/
		function visualFindRepeat(state, vis, sim, caret, count, key, col) {
			if (key !== ";" && key !== ",") return null;
			const find = findArgumentOf(state, key);
			if (find === null) return {
				state: clearPending(state),
				consume: true,
				ops: []
			};
			return finishVisualMotion(state, vis, sim, caret, resolveMotion(sim.text, caret, key, count, find), col);
		}
		/** Visual-motion completion: extend the selection and maintain the wanted column. */
		function finishVisualMotion(state, vis, sim, caret, motion, col) {
			if (motion === null) return {
				state: clearPending(state),
				consume: true,
				ops: []
			};
			const to = Math.max(0, Math.min(landingOf(sim.text, caret, motion, state.wantColumn), sim.text.length));
			const next = {
				...vis,
				caret: to
			};
			selectVisual(sim, next);
			const want = motion.want === "preserve" ? state.wantColumn ?? col : motion.want === "set" ? to - lineSpan(sim.text, lineStarts(sim.text), lineOf(lineStarts(sim.text), to)).start : null;
			return {
				state: {
					...clearPending(state),
					visual: next,
					wantColumn: want
				},
				consume: true,
				ops: sim.ops
			};
		}
		/** Fold one count digit into the pending count; null when the key is none (a bare `0` stays a motion). */
		function countDigitOf(state, key) {
			if (key >= "1" && key <= "9") return (state.count ?? 0) * 10 + Number(key);
			if (key === "0" && state.count !== null) return state.count * 10;
			return null;
		}
		/** Start the `g`/find wait for one key (operator-free); null when the key starts none. */
		function startPendingWait(state, key) {
			if (key === "g") return {
				state: {
					...state,
					pendingG: true
				},
				consume: true,
				ops: []
			};
			if (key === "f" || key === "F" || key === "t" || key === "T") return {
				state: {
					...state,
					pendingFind: key
				},
				consume: true,
				ops: []
			};
			return null;
		}
		/** The `;`/`,` repeat argument: the last find, inverted for `,`. */
		function findArgumentOf(state, key) {
			if (key !== ";" && key !== ",") return null;
			if (state.lastFind === null) return null;
			return key === ";" ? state.lastFind : {
				kind: invertFind(state.lastFind.kind),
				char: state.lastFind.char
			};
		}
		/** Plain-motion completion: move the caret and maintain the wanted column. */
		function finishPlainMotion(state, sim, caret, motion, col, wantColumn) {
			if (motion === null) return {
				state,
				consume: true,
				ops: []
			};
			const to = landingOf(sim.text, caret, motion, wantColumn);
			sim.move(to);
			const want = motion.want === "preserve" ? wantColumn ?? col : motion.want === "set" ? to - lineSpan(sim.text, lineStarts(sim.text), lineOf(lineStarts(sim.text), to)).start : null;
			return {
				state: {
					...clearPending(state),
					wantColumn: want
				},
				consume: true,
				ops: sim.ops
			};
		}
		/** Operator over a resolved motion: derive the span, then apply d/c/y. */
		function applyOperatorMotion(state, sim, caret, operator, motion) {
			if (motion === null) return {
				state: clearPending(state),
				consume: true,
				ops: []
			};
			if (motion.targetLine !== void 0) return applyLinewise(state, sim, operator, lineOf(lineStarts(sim.text), caret), motion.targetLine);
			return applyCharwise(state, sim, operator, Math.min(motion.from, motion.to ?? motion.from), Math.max(motion.from, motion.to ?? motion.from));
		}
		/**
		* Linewise operator application over lines [first, last]: yank stores the
		* lines; delete removes them with their terminators (the preceding line's
		* terminator goes with the final line so no blank line remains); change
		* keeps one empty line and enters insert.
		*/
		function applyLinewise(state, sim, operator, first, last) {
			const starts = lineStarts(sim.text);
			const orderedFirst = Math.min(first, last);
			const orderedLast = Math.max(first, last);
			const spanStart = starts[orderedFirst] ?? 0;
			const lastIsFinal = orderedLast + 1 >= starts.length;
			const afterLast = starts[orderedLast + 1] ?? sim.text.length;
			const deleteStart = lastIsFinal && orderedFirst > 0 ? spanStart - 1 : spanStart;
			const deleteEnd = lastIsFinal ? sim.text.length : afterLast;
			const changeEnd = lastIsFinal ? sim.text.length : afterLast - 1;
			const deleted = sim.text.slice(spanStart, lastIsFinal ? sim.text.length : afterLast - 1);
			if (operator === "y") return {
				state: {
					...clearPending(state),
					register: {
						text: deleted,
						linewise: true
					},
					wantColumn: null
				},
				consume: true,
				ops: []
			};
			if (operator === "c") {
				sim.select(spanStart, changeEnd);
				sim.replace(spanStart, changeEnd, "");
				sim.move(spanStart);
				return {
					state: {
						...clearPending(state),
						mode: "insert",
						wantColumn: null
					},
					consume: true,
					ops: sim.ops
				};
			}
			sim.select(deleteStart, deleteEnd);
			sim.replace(deleteStart, deleteEnd, "");
			const landing = Math.min(lastIsFinal && orderedFirst > 0 ? starts[orderedFirst - 1] ?? 0 : spanStart, sim.text.length);
			sim.move(landing);
			return {
				state: {
					...clearPending(state),
					register: {
						text: deleted,
						linewise: true
					},
					wantColumn: null
				},
				consume: true,
				ops: sim.ops
			};
		}
		/** Charwise operator application over the [from, to) span. */
		function applyCharwise(state, sim, operator, from, to) {
			if (operator === "y") return {
				state: {
					...clearPending(state),
					register: {
						text: sim.text.slice(from, to),
						linewise: false
					},
					wantColumn: null
				},
				consume: true,
				ops: []
			};
			const deleted = sim.text.slice(from, to);
			sim.select(from, to);
			sim.replace(from, to, "");
			const landing = Math.min(from, sim.text.length);
			sim.move(landing);
			if (operator === "c") return {
				state: {
					...clearPending(state),
					mode: "insert",
					wantColumn: null
				},
				consume: true,
				ops: sim.ops
			};
			return {
				state: {
					...clearPending(state),
					register: {
						text: deleted,
						linewise: false
					},
					wantColumn: null
				},
				consume: true,
				ops: sim.ops
			};
		}
		//#endregion
		//#region src/client/vim/visualLines.ts
		/**
		* Display-row measurement for `gj`/`gk`: mirrors the focused composer editor
		* into an offscreen element with the editor's typography and the same
		* content-box width, then walks the detect-projection text (chip = one
		* U+FFFC) char by char reading each glyph's client rect to detect the rows
		* soft wrapping produced. Range client rects are engine-fragile (browsers
		* return empty lists for various focus/visibility states), so a canvas
		* word-wrap simulation answers whenever the rect walk could not measure —
		* and null (the caller degrades to `j`/`k`) when neither strategy can.
		* Pure DOM, no cordis/React; consulted lazily by the controller only while
		* the vim machine waits on a `g` prefix.
		*/
		/** Vertical distance (px) below which two glyph tops read as the same row. */
		const ROW_TOLERANCE = 2;
		/** Typography properties that decide where the browser breaks lines. */
		const TYPOGRAPHY_PROPS = [
			"direction",
			"font-family",
			"font-kerning",
			"font-size",
			"font-stretch",
			"font-style",
			"font-variant",
			"font-variant-ligatures",
			"font-feature-settings",
			"font-weight",
			"letter-spacing",
			"word-spacing",
			"tab-size",
			"text-align",
			"text-indent",
			"text-transform",
			"text-rendering",
			"text-wrap",
			"white-space",
			"white-space-collapse",
			"word-break",
			"overflow-wrap",
			"line-break",
			"hyphens",
			"box-sizing",
			"border-left-width",
			"border-right-width",
			"padding-left",
			"padding-right"
		];
		/** The CSS font shorthand a canvas context accepts, built from computed styles. */
		function canvasFont(styles) {
			return [
				styles.fontStyle,
				styles.fontVariant,
				styles.fontWeight,
				styles.fontSize,
				styles.fontFamily
			].join(" ");
		}
		/**
		* Measure the display-row start offsets of one document rendering.
		* @param text - the detect-projection text (chip = one U+FFFC character).
		* @returns sorted row-start offsets ([0] === 0), or null when no strategy
		* could measure — callers degrade to logical `j`/`k`.
		*/
		function measureVisualLines(text) {
			if (typeof document === "undefined" || text === "") return null;
			const host = document.activeElement;
			if (!(host instanceof HTMLElement)) return null;
			const styles = getComputedStyle(host);
			const clientWidth = host.clientWidth;
			if (clientWidth <= 0) return null;
			const contentBox = clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
			if (!Number.isFinite(contentBox) || contentBox <= 0) return null;
			const fromRects = rectRowStarts(text, styles, contentBox);
			if (fromRects !== null) return fromRects;
			const fromCanvas = canvasRowStarts(text, styles, contentBox);
			return fromCanvas.length > 0 ? fromCanvas : null;
		}
		/**
		* Primary strategy: a mirror element pinned offscreen (visible — visibility
		* tricks are exactly what collapses Range rects) carrying the editor's
		* typography, walked glyph by glyph.
		* @returns row starts, or null when the engine answered no rects at all.
		*/
		function rectRowStarts(text, styles, contentBox) {
			const mirror = document.createElement("div");
			try {
				for (const prop of TYPOGRAPHY_PROPS) {
					const value = styles.getPropertyValue(prop);
					if (value !== "") mirror.style.setProperty(prop, value);
				}
				Object.assign(mirror.style, {
					position: "fixed",
					left: "-10000px",
					top: "0",
					width: `${contentBox}px`,
					height: "auto",
					maxHeight: "none",
					whiteSpace: "pre-wrap",
					overflowWrap: "break-word"
				});
				mirror.textContent = text;
				document.body.appendChild(mirror);
				const node = mirror.firstChild;
				if (node === null || node.nodeType !== Node.TEXT_NODE) return null;
				const textNode = node;
				const range = document.createRange();
				let rowTop = null;
				let measured = 0;
				const starts = [0];
				for (let i = 0; i < text.length; i += 1) {
					range.setStart(textNode, i);
					range.setEnd(textNode, i + 1);
					const rect = range.getClientRects()[0];
					if (rect === void 0) continue;
					measured += 1;
					const top = rect.top;
					const forced = i > 0 && text[i - 1] === "\n";
					if (rowTop === null) rowTop = top;
					else if (forced || Math.abs(top - rowTop) > ROW_TOLERANCE) {
						starts.push(i);
						rowTop = top;
					}
				}
				if (measured === 0) return null;
				return starts;
			} catch {
				return null;
			} finally {
				mirror.remove();
			}
		}
		/**
		* Fallback strategy: greedy word-wrap simulation over canvas glyph widths —
		* break after the last space that fit, or mid-word when none did. Less exact
		* than the browser's own line breaking, but immune to Range rect quirks.
		*/
		function canvasRowStarts(text, styles, width) {
			const ctx = document.createElement("canvas").getContext("2d");
			if (ctx === null) return [];
			ctx.font = canvasFont(styles);
			const spaced = ctx;
			if ("letterSpacing" in spaced) spaced.letterSpacing = styles.letterSpacing;
			const widthOf = (i) => ctx.measureText(text[i] ?? "").width;
			const starts = [0];
			/** Record the offset a fresh row opens at (deduped, bounded to real glyphs). */
			const openRow = (p) => {
				if (p > 0 && p < text.length && starts[starts.length - 1] !== p) starts.push(p);
			};
			let rowStart = 0;
			let x = 0;
			let lastSpaceFit = -1;
			for (let i = 0; i < text.length; i += 1) {
				const ch = text[i] ?? "";
				if (ch === "\n") {
					rowStart = i + 1;
					x = 0;
					lastSpaceFit = -1;
					openRow(rowStart);
					continue;
				}
				const w = widthOf(i);
				if (x > 0 && x + w > width) {
					if (lastSpaceFit >= rowStart) rowStart = lastSpaceFit + 1;
					else rowStart = i;
					openRow(rowStart);
					x = 0;
					lastSpaceFit = -1;
					for (let j = rowStart; j <= i; j += 1) {
						x += widthOf(j);
						if (text[j] === " ") lastSpaceFit = j;
					}
					continue;
				}
				x += w;
				if (ch === " ") lastSpaceFit = i;
			}
			return starts;
		}
		//#endregion
		//#region src/client/controller.ts
		/**
		* VimController: the plugin's single apply-closure instance. Owns the pure
		* machine state, the persisted enabled preference, and the published mode;
		* `keydown` is the ComposerKeysService interceptor — it folds each keydown
		* through the machine and applies the resulting operations to the session's
		* editing face.
		*/
		/** localStorage key of the enabled preference (see client-store persistence). */
		const PERSIST_KEY = "dsh.vim-mode.enabled";
		/**
		* The vim mode controller.
		* @param enabledInitial - fallback when no preference is persisted (non-browser runs, first visit).
		*/
		var VimController = class {
			/** Persisted master switch (localStorage; failures only disable persistence). */
			enabled;
			/** Live editor mode (transient; every load starts in insert). */
			mode;
			machine = INITIAL_VIM_STATE;
			constructor(enabledInitial) {
				this.enabled = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(enabledInitial, { persist: { name: PERSIST_KEY } });
				this.mode = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)("insert");
			}
			/**
			* Turn vim editing on or off; the machine resets so a re-enable starts clean in insert.
			* @param next whether the vim layer should intercept composer keys
			*/
			setEnabled(next) {
				this.machine = INITIAL_VIM_STATE;
				this.mode.set("insert");
				this.enabled.set(next);
			}
			/** The mode an indicator surface should show: visual outranks the underlying normal mode. */
			publishedMode(state) {
				return state.visual !== null ? "visual" : state.mode;
			}
			/** Flip the master switch (the toggle button and badge gesture). */
			toggle() {
				this.setEnabled(!this.enabled.getSnapshot());
			}
			/**
			* The ComposerKeysService interceptor: fold one keydown through the machine
			* and apply its operations. Everything runs synchronously inside the
			* keydown, so the editing face's reads observe each applied operation.
			* @param face - the focused session's editing face.
			* @param event - the raw keydown.
			* @returns true when vim consumed the key.
			*/
			keydown(face, event) {
				if (!this.enabled.getSnapshot()) return false;
				if (event.key === "Unidentified") return false;
				const text = face.text();
				const selection = face.selection();
				const caret = selection === null ? face.caret() ?? text.length : selection.end;
				const vlines = this.machine.pendingG ? measureVisualLines(text) : null;
				const result = step(this.machine, {
					text,
					caret,
					selection,
					vlines
				}, {
					key: event.key,
					ctrl: event.ctrlKey,
					meta: event.metaKey,
					alt: event.altKey,
					shift: event.shiftKey
				});
				if (!result.consume) return false;
				for (const op of result.ops) switch (op.type) {
					case "move":
						face.moveTo(op.to);
						break;
					case "select":
						face.selectRange(op.start, op.end);
						break;
					case "replace":
						face.replaceRange(op.start, op.end, op.text);
						break;
					case "break":
						face.insertBreak(op.at);
						break;
					case "undo": face.undo();
				}
				this.machine = result.state;
				const published = this.publishedMode(result.state);
				if (this.mode.getSnapshot() !== published) this.mode.set(published);
				return true;
			}
		};
		//#endregion
		//#region src/client/blockCursor.ts
		/** Fraction of the composer's font size used when the caret has no character under it (line ends, empty drafts). */
		const BARE_WIDTH_RATIO = .6;
		/** Pixel fallback when the font size itself is unreadable. */
		const BARE_WIDTH_FLOOR = 8;
		/** Line height used when the surface reports `normal` and only the font size is measurable. */
		const EMPTY_LINE_RATIO = 1.2;
		/**
		* The composer's editing surface of the card containing `root`.
		* @param root - any element rendered inside the composer card.
		* @returns the card's contenteditable, or null when `root` sits in no card or the card has no editable surface.
		*/
		function composerEditableOf(root) {
			const card = root?.closest("[data-composer-card]");
			if (card === null || card === void 0) return null;
			return card.querySelector("[contenteditable=\"true\"]");
		}
		/** The caret's fallback width: a fraction of the surface's own font size. */
		function bareWidth(editable) {
			const size = parseFloat(getComputedStyle(editable).fontSize);
			return Number.isFinite(size) ? size * BARE_WIDTH_RATIO : BARE_WIDTH_FLOOR;
		}
		/** A plain box view of one DOMRect, substituting the bare width when the rect is widthless. */
		function boxOf(rect, fallbackWidth) {
			return {
				left: rect.left,
				top: rect.top,
				width: rect.width > 0 ? rect.width : fallbackWidth,
				height: rect.height
			};
		}
		/**
		* The box the block caret covers for one collapsed range: the character at
		* the caret when one exists, otherwise a bare-width box at the caret's
		* position (the caret then sits past the last character of its text node).
		* @param editable - the composer's editing surface (font-size source).
		* @param range - the collapsed selection range inside it.
		* @returns the box, or null when the caret has no measurable position.
		*/
		function charBox(editable, range) {
			const width = bareWidth(editable);
			const node = range.startContainer;
			if (node instanceof Text) {
				const text = node.data;
				const at = range.startOffset;
				if (at < text.length) {
					const span = document.createRange();
					span.setStart(node, at);
					span.setEnd(node, at + 1);
					return boxOf(span.getBoundingClientRect(), width);
				}
				if (at > 0) {
					const span = document.createRange();
					span.setStart(node, at - 1);
					span.setEnd(node, at);
					const prev = span.getBoundingClientRect();
					if (prev.height > 0) return {
						left: prev.right,
						top: prev.top,
						width,
						height: prev.height
					};
				}
			}
			const box = range.getBoundingClientRect();
			if (box.height > 0 || box.width > 0) return boxOf(box, width);
			return emptyBox(editable, width);
		}
		/**
		* The empty-draft fallback cell: the block caret anchored at the surface's
		* first line when the collapsed selection has no character geometry of its
		* own (an empty draft, or a caret on an unrendered node). Prefers the
		* contents range's first client rect (the line box at the insertion point);
		* falls back to the editable's own box inset by its padding, with the
		* line-height (or font-size-derived) height.
		* @param editable - the composer's editing surface.
		* @param width - the bare caret width.
		* @returns the fallback box, or null when even the surface is unmeasurable.
		*/
		function emptyBox(editable, width) {
			const contents = editable.ownerDocument.createRange();
			contents.selectNodeContents(editable);
			const first = typeof contents.getClientRects === "function" ? contents.getClientRects()[0] : void 0;
			if (first !== void 0 && first.height > 0) return {
				left: first.left,
				top: first.top,
				width,
				height: first.height
			};
			const box = editable.getBoundingClientRect();
			if (box.height <= 0) return null;
			const style = getComputedStyle(editable);
			const pad = (value) => {
				const parsed = parseFloat(value);
				return Number.isFinite(parsed) ? parsed : 0;
			};
			const lineHeight = parseFloat(style.lineHeight);
			const size = parseFloat(style.fontSize);
			const height = Number.isFinite(lineHeight) ? lineHeight : Number.isFinite(size) ? size * EMPTY_LINE_RATIO : box.height;
			return {
				left: box.left + pad(style.paddingLeft),
				top: box.top + pad(style.paddingTop),
				width,
				height
			};
		}
		/**
		* Measure the block caret for the selection inside the composer card that
		* `anchor` renders in.
		* @param anchor - the overlay element the block will be positioned against.
		* @returns the block box relative to the anchor, or null while the anchor has
		* no card, the selection lives outside the card's surface, or the caret has
		* no measurable position (ranged selections get no block — they are their
		* own highlight).
		*/
		function computeCaretBlock(anchor) {
			if (anchor === null) return null;
			const editable = composerEditableOf(anchor);
			if (editable === null) return null;
			const view = anchor.ownerDocument.defaultView;
			/* v8 ignore next -- defaultView is null only for a document without a browsing context; the overlay renders in the live one. */
			if (view === null) return null;
			const selection = view.getSelection();
			/* v8 ignore next -- getSelection is null only while its window is closing; the overlay renders in the live one. */
			if (selection === null || selection.rangeCount === 0) return null;
			const range = selection.getRangeAt(0);
			if (!range.collapsed) return null;
			const node = range.startContainer;
			if (node !== editable && !editable.contains(node)) return null;
			const box = charBox(editable, range);
			if (box === null) return null;
			const base = anchor.getBoundingClientRect();
			return {
				left: box.left - base.left,
				top: box.top - base.top,
				width: box.width,
				height: box.height
			};
		}
		//#endregion
		//#region \0dsh-css:/Users/wingillis/dev/dsh-plugins/plugins/dsh-vim-plugin/src/client/vim.module.css.mjs
		const css = ".TvqmIa_overlay{pointer-events:none;position:absolute;inset:0}.TvqmIa_badge{z-index:90;border:1px solid var(--dsw-alias-border-l);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);letter-spacing:.08em;pointer-events:none;border-radius:6px;padding:1px 8px;font-family:ui-monospace,monospace;font-size:11px;line-height:16px;position:absolute;bottom:52px;right:10px}.TvqmIa_toggle{height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:8px;flex:none;padding:0 10px;font-family:ui-monospace,monospace;font-size:12px;font-weight:500;line-height:18px}.TvqmIa_toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}.TvqmIa_toggle.TvqmIa_active{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}.TvqmIa_block{z-index:90;background:var(--dsw-alias-brand-primary);opacity:.35;border-radius:1px;animation:1.1s step-end infinite TvqmIa_dsh-vim-blink;position:absolute}@keyframes TvqmIa_dsh-vim-blink{0%,55%{opacity:.35}56%,to{opacity:0}}@media (prefers-reduced-motion:reduce){.TvqmIa_block{animation:none}}.TvqmIa_blockCaret{caret-color:#0000}";
		const tagId = "dsh-vim-plugin/vim.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-vim-plugin";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var vim_module_css_default = {
			"active": "TvqmIa_active",
			"badge": "TvqmIa_badge",
			"block": "TvqmIa_block",
			"blockCaret": "TvqmIa_blockCaret",
			"dsh-vim-blink": "TvqmIa_dsh-vim-blink",
			"overlay": "TvqmIa_overlay",
			"toggle": "TvqmIa_toggle"
		};
		//#endregion
		//#region src/client/VimBadge.tsx
		/**
		* Composer mode chrome: the conversation.input.overlay entry. While vim
		* editing is enabled and the machine sits in a modal mode it renders the
		* classic mode line (NORMAL, or VISUAL while a selection grows); insert is
		* the composer's native posture and stays unbadge. In NORMAL mode it also
		* renders the block caret — a box over the character under the caret — and
		* suppresses the composer's thin native caret for the same card. Pointer
		* events stay off so the chrome never intercepts composer interaction.
		*/
		/**
		* Track the block-caret box while a modal caret owns the card's selection.
		* Re-measured on selection, scroll, resize, and surface-layout changes —
		* every channel that can move the caret's on-screen box.
		* @param anchorRef - the overlay anchor element.
		* @param active - whether the block caret should render.
		* @returns the measured box, or null while there is nothing to cover.
		*/
		function useCaretBlock(anchorRef, active) {
			const [block, setBlock] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!active) {
					setBlock(null);
					return;
				}
				const measure = () => {
					setBlock(computeCaretBlock(anchorRef.current));
				};
				measure();
				document.addEventListener("selectionchange", measure);
				window.addEventListener("resize", measure);
				document.addEventListener("scroll", measure, true);
				const editable = composerEditableOf(anchorRef.current);
				let observer = null;
				if (editable !== null) {
					observer = new ResizeObserver(measure);
					observer.observe(editable);
				}
				return () => {
					document.removeEventListener("selectionchange", measure);
					window.removeEventListener("resize", measure);
					document.removeEventListener("scroll", measure, true);
					observer?.disconnect();
				};
			}, [active, anchorRef]);
			return block;
		}
		/**
		* Suppress the composer's thin native caret while a modal mode owns the
		* card, so the block caret (or the visual selection) is the only cursor.
		* @param anchorRef - the overlay anchor element.
		* @param modal - whether any modal mode is active.
		*/
		function useHiddenNativeCaret(anchorRef, modal) {
			(0, react.useEffect)(() => {
				if (!modal) return;
				const editable = composerEditableOf(anchorRef.current);
				if (editable === null) return;
				editable.classList.add(vim_module_css_default.blockCaret);
				return () => {
					editable.classList.remove(vim_module_css_default.blockCaret);
				};
			}, [modal, anchorRef]);
		}
		/**
		* Render the mode badge and block-caret overlay entry.
		* @param props - injected face (enabled and mode hooks); `t` rides the locale seat.
		* @returns the overlay while vim is enabled; null otherwise.
		*/
		function VimBadge({ useEnabled, useMode, t }) {
			const enabled = useEnabled((value) => value);
			const mode = useMode((value) => value);
			const anchorRef = (0, react.useRef)(null);
			const modal = enabled && mode !== "insert";
			const block = useCaretBlock(anchorRef, modal && mode === "normal");
			useHiddenNativeCaret(anchorRef, modal);
			if (!enabled) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: anchorRef,
				className: vim_module_css_default.overlay,
				children: [modal && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: vim_module_css_default.badge,
					role: "status",
					"aria-live": "polite",
					children: mode === "visual" ? t("mode.visual") : t("mode.normal")
				}), block !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"aria-hidden": true,
					className: vim_module_css_default.block,
					style: {
						left: `${block.left}px`,
						top: `${block.top}px`,
						width: `${block.width}px`,
						height: `${block.height}px`
					}
				})]
			});
		}
		//#endregion
		//#region ../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region src/client/VimToggle.tsx
		/**
		* Composer tool-row toggle: the conversation.input.left entry. A compact
		* chip-like button showing the vim master switch (aria-pressed); pressing it
		* flips the persisted preference and resets the machine.
		*/
		/**
		* Render the tool-row toggle entry.
		* @param props - injected face (hooks and the toggle route); `t` rides the locale seat.
		* @returns the toggle button.
		*/
		function VimToggle({ useEnabled, toggle, t }) {
			const enabled = useEnabled((value) => value);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: enabled ? t("toggle.disable") : t("toggle.enable"),
				side: "top",
				delayMs: 500,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: clsx(vim_module_css_default.toggle, enabled && vim_module_css_default.active),
					"aria-pressed": enabled,
					"aria-label": t("toggle.label"),
					onClick: toggle,
					children: t("toggle.label")
				})
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* `vim.mode` namespace dictionaries: the composer toggle and the mode
		* indicator copy.
		*/
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"toggle.label": "Vim",
			"toggle.enable": "启用 Vim 编辑",
			"toggle.disable": "停用 Vim 编辑",
			"mode.normal": "NORMAL",
			"mode.insert": "INSERT",
			"mode.visual": "VISUAL",
			"command.description": "切换 Vim 编辑（当前：{state}）",
			"command.state.enabled": "已启用",
			"command.state.disabled": "已停用",
			"command.attachmentsUnsupported": "附件不能伴随 /vim 命令提交"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"toggle.label": "Vim",
			"toggle.enable": "Enable Vim editing",
			"toggle.disable": "Disable Vim editing",
			"mode.normal": "NORMAL",
			"mode.insert": "INSERT",
			"mode.visual": "VISUAL",
			"command.description": "Toggle Vim editing (currently: {state})",
			"command.state.enabled": "enabled",
			"command.state.disabled": "disabled",
			"command.attachmentsUnsupported": "Attachments cannot accompany the /vim command"
		};
		//#endregion
		//#region src/client/index.ts
		/** Namespace owning the toggle and badge copy. */
		const VIM_NS = "vim.mode";
		/** The bare slash token the vim source owns. */
		const VIM_TOKEN = "/vim";
		/** Required services: the slot tree, the locale seat, the composer keyboard registry, and the slash-trigger pipeline. */
		const inject = [
			"slots",
			"locale",
			"composerKeys",
			"inputTriggers",
			"sessions"
		];
		/**
		* Client plugin body: mount the controller, register the keydown
		* interceptor, and contribute both chrome entries.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			const controller = new VimController(false);
			ctx.effect(() => ctx.locale.register(VIM_NS, {
				zh,
				en
			}), "ui-vim-mode: dictionaries");
			const t = ctx.locale.bind(VIM_NS);
			const vimSource = {
				trigger: "/",
				name: "vim",
				showGroupTitle: false,
				candidates: async () => [{
					name: "vim",
					description: t("command.description", { state: controller.enabled.getSnapshot() ? t("command.state.enabled") : t("command.state.disabled") })
				}],
				onPick: (pick) => {
					if (pick.candidate.name !== "vim") return void 0;
					controller.toggle();
					return { text: "" };
				},
				matchEnter: async (session, line, _signal, envelope) => {
					if (line.trim() !== VIM_TOKEN) return void 0;
					if (envelope.attachments > 0) throw new Error(t("command.attachmentsUnsupported"));
					controller.toggle();
					const actx = ctx.sessions.scope(session.sessionId);
					actx?.bail(actx, "slash/input-consume-token", { guard: {
						kind: "bare-token",
						token: VIM_TOKEN
					} });
					return "handled";
				}
			};
			ctx.effect(() => ctx.inputTriggers.registerSource(vimSource), "ui-vim-mode: /vim source");
			ctx.effect(() => ctx.composerKeys.register({ keydown: (face, event) => controller.keydown(face, event) }), "ui-vim-mode: composer keydown interceptor");
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "vim-toggle",
				order: 40,
				locale: VIM_NS,
				inject: () => ({
					hooks: {
						enabled: controller.enabled,
						mode: controller.mode
					},
					toggle: () => {
						controller.toggle();
					}
				})
			}, VimToggle));
			ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
				name: "conversation.input.overlay",
				id: "vim-badge",
				order: 100,
				locale: VIM_NS,
				inject: () => ({ hooks: {
					enabled: controller.enabled,
					mode: controller.mode
				} })
			}, VimBadge));
		}
		//#endregion
		exports.VimController = VimController;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map