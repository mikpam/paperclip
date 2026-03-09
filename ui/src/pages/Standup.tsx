import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Radio } from "lucide-react";
import type { Agent } from "@paperclipai/shared";

/* ── role → color map ──────────────────────────── */

const ROLE_COLORS: Record<string, string> = {
  ceo: "#B87333",
  cto: "#6366F1",
  orchestrator: "#8B5CF6",
  qa: "#EF4444",
  cmo: "#10B981",
  cfo: "#34D399",
  analyst: "#38BDF8",
  devops: "#F59E0B",
  architect: "#A78BFA",
  researcher: "#FB923C",
};

const STANDUP_ROLES = new Set(Object.keys(ROLE_COLORS));

/* ── per-agent state ───────────────────────────── */

interface AgentStandupState {
  status: "idle" | "loading" | "done" | "error";
  response: string;
}

/* ── helpers ────────────────────────────────────── */

function buildSystemPrompt(agent: Agent): string {
  const lines = [
    `You are ${agent.name}, the ${agent.role.toUpperCase()} of the company.`,
  ];
  if (agent.title) lines.push(`Your title is ${agent.title}.`);
  if (agent.capabilities) lines.push(`Your capabilities include: ${agent.capabilities}`);
  return lines.join(" ");
}

function agentModel(agent: Agent): string {
  const cfg = agent.adapterConfig as Record<string, unknown>;
  return typeof cfg.model === "string" ? cfg.model : agent.adapterType;
}

const API_KEY_STORAGE = "standup_anthropic_key";

/* ── component ──────────────────────────────────── */

export function Standup() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Standup" }]);
  }, [setBreadcrumbs]);

  const { data: agents, isLoading } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const standupAgents = useMemo(
    () =>
      (agents ?? []).filter(
        (a) => STANDUP_ROLES.has(a.role) && a.status !== "terminated",
      ),
    [agents],
  );

  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? "");
  const [weekContext, setWeekContext] = useState("");
  const [states, setStates] = useState<Record<string, AgentStandupState>>({});
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const saveApiKey = useCallback((v: string) => {
    setApiKey(v);
    localStorage.setItem(API_KEY_STORAGE, v);
  }, []);

  /* ── fire all standups in parallel ────────── */

  const runStandup = useCallback(async () => {
    if (!apiKey || standupAgents.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);

    const initial: Record<string, AgentStandupState> = {};
    for (const a of standupAgents) {
      initial[a.id] = { status: "loading", response: "" };
    }
    setStates(initial);

    const userMessage = `WEEK CONTEXT:\n${weekContext || "(none provided)"}\n\nDeliver your Monday standup. 4-5 sentences. First person, present tense. Own your domain. No pleasantries.`;

    await Promise.allSettled(
      standupAgents.map(async (agent) => {
        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1000,
              system: buildSystemPrompt(agent),
              messages: [{ role: "user", content: userMessage }],
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const body = await res.text();
            throw new Error(`${res.status}: ${body.slice(0, 200)}`);
          }

          const json = await res.json() as {
            content: Array<{ type: string; text?: string }>;
          };
          const text =
            json.content
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("\n") || "(empty response)";

          setStates((prev) => ({
            ...prev,
            [agent.id]: { status: "done", response: text },
          }));
        } catch (err) {
          if (controller.signal.aborted) return;
          setStates((prev) => ({
            ...prev,
            [agent.id]: {
              status: "error",
              response: err instanceof Error ? err.message : "Unknown error",
            },
          }));
        }
      }),
    );

    setRunning(false);
  }, [apiKey, standupAgents, weekContext]);

  /* ── progress ─────────────────────────────── */

  const completedCount = Object.values(states).filter(
    (s) => s.status === "done" || s.status === "error",
  ).length;
  const totalCount = standupAgents.length;

  /* ── render ───────────────────────────────── */

  if (!selectedCompanyId) {
    return <EmptyState icon={Radio} message="Select a company to run standup." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  if (standupAgents.length === 0) {
    return <EmptyState icon={Radio} message="No standup-eligible agents found." />;
  }

  return (
    <div className="space-y-6">
      {/* API Key + Week Context */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Anthropic API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => saveApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Week Context
            </label>
            <textarea
              value={weekContext}
              onChange={(e) => setWeekContext(e.target.value)}
              rows={4}
              placeholder="Paste your WEEK_CONTEXT here — priorities, blockers, key events..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground resize-y"
            />
          </div>
          <Button onClick={runStandup} disabled={running || !apiKey}>
            {running ? "Running..." : "Run Standup"}
          </Button>
        </CardContent>
      </Card>

      {/* Progress bar */}
      {totalCount > 0 && Object.keys(states).length > 0 && (
        <div className="flex h-2 w-full rounded-full overflow-hidden bg-muted gap-px">
          {standupAgents.map((agent) => {
            const s = states[agent.id];
            const done = s?.status === "done" || s?.status === "error";
            const color = ROLE_COLORS[agent.role] ?? "#71717A";
            return (
              <div
                key={agent.id}
                className="h-full transition-all duration-300"
                style={{
                  flex: 1,
                  backgroundColor: done ? color : "transparent",
                }}
              />
            );
          })}
        </div>
      )}

      {/* Status line */}
      {Object.keys(states).length > 0 && (
        <p className="text-xs text-muted-foreground">
          {completedCount} / {totalCount} agents reported
        </p>
      )}

      {/* Agent cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {standupAgents.map((agent) => {
          const s = states[agent.id];
          const color = ROLE_COLORS[agent.role] ?? "#71717A";
          const model = agentModel(agent);

          return (
            <Card key={agent.id} className="flex flex-col">
              <CardContent className="p-4 flex flex-col gap-3 flex-1">
                {/* Header: avatar chip + name + model */}
                <div className="flex items-start gap-3">
                  <span
                    className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md text-[10px] font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {agent.role.slice(0, 3).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{agent.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{model}</p>
                  </div>
                </div>

                {/* Body */}
                <div className="flex-1 text-sm text-foreground">
                  {!s || s.status === "idle" ? (
                    <p className="text-muted-foreground italic">Waiting to run...</p>
                  ) : s.status === "loading" ? (
                    <p className="text-muted-foreground animate-pulse">
                      Thinking
                      <span className="inline-block w-6 text-left tracking-widest">...</span>
                    </p>
                  ) : s.status === "error" ? (
                    <p className="text-destructive text-xs break-all">{s.response}</p>
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed">{s.response}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
