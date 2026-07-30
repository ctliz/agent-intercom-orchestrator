import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

type Worker = {
  id: string;
  harness: string;
  role: string;
  state: string;
  task?: string;
  cwd?: string;
  model?: string;
  effort?: string;
  permissionProfile?: string;
  intercomTarget?: string;
  unit?: string;
  mainPid?: number;
  managerSessionId?: string;
  updatedAt?: number;
  idleDeadlineAt?: number;
  lastError?: string;
};

type WorkerFile = { workers?: Worker[] };

const LIVE_STATES = new Set(["provisioning", "running", "idle", "needs_attention", "stopping"]);
const STATE_PATH = join(getAgentDir(), "intercom", "orchestrator", "workers.json");

async function readWorkers(): Promise<Worker[]> {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8")) as WorkerFile;
    return [...(parsed.workers ?? [])].sort((a, b) => {
      const liveDifference = Number(LIVE_STATES.has(b.state)) - Number(LIVE_STATES.has(a.state));
      return liveDifference || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id);
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function time(value?: number): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function shortDirectory(path?: string): string {
  if (!path) return "—";
  const name = basename(path);
  return name || path;
}

export default function coagentBrowser(pi: ExtensionAPI) {
  pi.registerCommand("coagents", {
    description: "Open the standalone read-only co-agent browser",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/coagents requires interactive TUI mode", "error");
        return;
      }

      let workers = await readWorkers();
      let showAll = false;
      let selected = 0;
      let expanded = false;
      let refreshing = false;
      let refreshError: string | undefined;

      await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
        const visibleWorkers = () => showAll ? workers : workers.filter((worker) => LIVE_STATES.has(worker.state));
        const clampSelection = () => {
          const visible = visibleWorkers();
          selected = Math.max(0, Math.min(selected, Math.max(0, visible.length - 1)));
        };
        const refresh = async () => {
          if (refreshing) return;
          refreshing = true;
          refreshError = undefined;
          tui.requestRender();
          try {
            workers = await readWorkers();
            clampSelection();
          } catch (error) {
            refreshError = error instanceof Error ? error.message : String(error);
          } finally {
            refreshing = false;
            tui.requestRender();
          }
        };

        return {
          render(width: number): string[] {
            const inner = Math.max(20, width - 4);
            const visible = visibleWorkers();
            clampSelection();
            const liveCount = workers.filter((worker) => LIVE_STATES.has(worker.state)).length;
            const border = theme.fg("border", "─".repeat(Math.max(1, width)));
            const lines: string[] = [border];
            const mode = showAll ? "all retained" : "live only";
            lines.push(truncateToWidth(`  ${theme.fg("accent", theme.bold("Co-agent Browser"))}  ${theme.fg("muted", `${liveCount} live · ${workers.length} total · ${mode}`)}`, width));
            lines.push(border);

            if (visible.length === 0) {
              lines.push(truncateToWidth(`  ${theme.fg("muted", "No matching coworkers.")}`, width));
              lines.push("");
            } else {
              const maxRows = 8;
              const start = Math.max(0, Math.min(selected - Math.floor(maxRows / 2), Math.max(0, visible.length - maxRows)));
              const end = Math.min(visible.length, start + maxRows);
              for (let index = start; index < end; index += 1) {
                const worker = visible[index]!;
                const active = index === selected;
                const prefix = active ? theme.fg("accent", "›") : " ";
                const stateColor = worker.state === "failed" || worker.state === "lost"
                  ? "error"
                  : LIVE_STATES.has(worker.state)
                    ? "success"
                    : "muted";
                const row = `${prefix} ${theme.fg("accent", worker.id)}  ${theme.fg("warning", worker.harness)}/${theme.fg("muted", worker.role)}  ${theme.fg(stateColor, worker.state)}`;
                const styled = active ? theme.bg("selectedBg", row) : row;
                lines.push(truncateToWidth(` ${styled}`, width));
              }
              if (visible.length > maxRows) lines.push(truncateToWidth(`  ${theme.fg("dim", `${selected + 1}/${visible.length}`)}`, width));

              const worker = visible[selected]!;
              lines.push(border);
              const stateColor = worker.state === "failed" || worker.state === "lost"
                ? "error"
                : LIVE_STATES.has(worker.state)
                  ? "success"
                  : "muted";
              lines.push(truncateToWidth(`  ${theme.fg("accent", theme.bold(worker.id))}  ${theme.fg(stateColor, worker.state)}`, width));
              const identity = [
                `${theme.fg("dim", "harness")} ${theme.fg("warning", worker.harness)}`,
                `${theme.fg("dim", "role")} ${theme.fg("accent", worker.role)}`,
                worker.model ? `${theme.fg("dim", "model")} ${theme.fg("text", worker.model)}${worker.effort ? theme.fg("warning", `/${worker.effort}`) : ""}` : worker.effort ? `${theme.fg("dim", "effort")} ${theme.fg("warning", worker.effort)}` : undefined,
                worker.permissionProfile ? `${theme.fg("dim", "permission")} ${theme.fg("muted", worker.permissionProfile)}` : undefined,
              ].filter(Boolean).join(theme.fg("dim", "  ·  "));
              lines.push(truncateToWidth(`  ${identity}`, width));
              lines.push(truncateToWidth(`  ${theme.fg("dim", "cwd")}  ${theme.fg("text", expanded ? worker.cwd ?? "—" : shortDirectory(worker.cwd))}`, width));

              if (worker.task) {
                const taskLimit = expanded ? 5 : 1;
                const taskLines = wrapTextWithAnsi(worker.task, inner - 6).slice(0, taskLimit);
                for (let index = 0; index < taskLines.length; index += 1) {
                  const label = index === 0 ? `${theme.fg("dim", "task")}  ` : "      ";
                  lines.push(truncateToWidth(`  ${label}${theme.fg("text", taskLines[index]!)}`, width));
                }
                if (!expanded && wrapTextWithAnsi(worker.task, inner - 6).length > 1) {
                  lines[lines.length - 1] = truncateToWidth(`${lines[lines.length - 1]} ${theme.fg("dim", "…")}`, width);
                }
              }

              if (expanded) {
                if (worker.intercomTarget) lines.push(truncateToWidth(`  ${theme.fg("dim", "intercom")}  ${theme.fg("accent", worker.intercomTarget)}`, width));
                if (worker.unit) lines.push(truncateToWidth(`  ${theme.fg("dim", "unit")}  ${worker.unit}${worker.mainPid ? ` · ${theme.fg("dim", "pid")} ${worker.mainPid}` : ""}`, width));
                lines.push(truncateToWidth(`  ${theme.fg("dim", "updated")}  ${time(worker.updatedAt)}  ${theme.fg("dim", "· idle deadline")}  ${time(worker.idleDeadlineAt)}`, width));
                if (worker.managerSessionId) lines.push(truncateToWidth(`  ${theme.fg("dim", "manager")}  ${worker.managerSessionId}`, width));
              }
              if (worker.lastError) lines.push(truncateToWidth(`  ${theme.fg("error", `error  ${worker.lastError}`)}`, width));
              lines.push(truncateToWidth(`  ${theme.fg("dim", `enter ${expanded ? "collapse" : "expand details"}`)}`, width));
            }

            if (refreshError) lines.push(truncateToWidth(`  ${theme.fg("error", `refresh failed: ${refreshError}`)}`, width));
            lines.push(border);
            lines.push(truncateToWidth(`  ${theme.fg("dim", `↑↓ select · enter ${expanded ? "collapse" : "expand"} · r refresh${refreshing ? "ing…" : ""} · a ${showAll ? "live only" : "show all"} · esc close · read-only`)}`, width));
            lines.push(border);
            return lines;
          },
          handleInput(data: string): void {
            const visible = visibleWorkers();
            if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
              done();
              return;
            }
            if (matchesKey(data, Key.up)) {
              selected = Math.max(0, selected - 1);
              expanded = false;
            } else if (matchesKey(data, Key.down)) {
              selected = Math.min(Math.max(0, visible.length - 1), selected + 1);
              expanded = false;
            } else if (matchesKey(data, Key.enter) && visible.length > 0) {
              expanded = !expanded;
            } else if (data === "a") {
              showAll = !showAll;
              expanded = false;
              clampSelection();
            } else if (data === "r") {
              void refresh();
              return;
            }
            tui.requestRender();
          },
          invalidate(): void {},
        };
      }, {
        overlay: true,
        overlayOptions: {
          width: "90%",
          minWidth: 64,
          maxHeight: "90%",
          anchor: "center",
          margin: 1,
        },
      });
    },
  });
}
