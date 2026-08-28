import { z } from "zod";
import type { FrameworkAdapter, FrameworkDetectionContext, HealthStatus } from "./contracts.js";

export const FrameworkEvidenceClassSchema = z.enum([
  "GENUINE_RUNTIME",
  "FIXTURE_BACKED_PROTOCOL",
  "DOCUMENTED_ONLY",
  "UNSUPPORTED",
]);
export type FrameworkEvidenceClass = z.infer<typeof FrameworkEvidenceClassSchema>;

export const FrameworkSupportTierSchema = z.enum(["tier-1", "tier-2", "tier-3"]);
export type FrameworkSupportTier = z.infer<typeof FrameworkSupportTierSchema>;

export const FrameworkSupportProfileSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
    displayName: z.string().min(1),
    packageNames: z.array(z.string().min(1)).min(1),
    commandTokens: z.array(z.string().min(1)).default([]),
    frameworkVersionRange: z.string().min(1),
    tier: FrameworkSupportTierSchema,
    evidenceClass: FrameworkEvidenceClassSchema,
    integration: z.enum(["native", "otlp-bridge", "callback-events"]),
    capabilities: z.array(z.string().min(1)).default([]),
    limitations: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type FrameworkSupportProfile = z.infer<typeof FrameworkSupportProfileSchema>;

export interface FrameworkProfileResolution {
  profile: FrameworkSupportProfile;
  source: "explicit-override" | "package" | "framework-hint" | "command";
  matched: string;
}

export type AdapterFactory = () => FrameworkAdapter;

const profiles = FrameworkSupportProfileSchema.array().parse([
  {
    id: "langgraph",
    displayName: "LangGraph",
    packageNames: ["@langchain/langgraph", "langgraph"],
    commandTokens: ["langgraph"],
    frameworkVersionRange: ">=1.4.9 <1.5.0",
    tier: "tier-1",
    evidenceClass: "GENUINE_RUNTIME",
    integration: "native",
    capabilities: ["lifecycle", "tools", "streaming", "checkpoint-resume", "subgraphs"],
    limitations: ["Hosted platform transport is documented only."],
  },
  {
    id: "openai-agents",
    displayName: "OpenAI Agents SDK",
    packageNames: ["@openai/agents"],
    commandTokens: ["openai-agents"],
    frameworkVersionRange: ">=0.14.3 <0.15.0",
    tier: "tier-1",
    evidenceClass: "GENUINE_RUNTIME",
    integration: "native",
    capabilities: ["lifecycle", "tools", "handoffs", "guardrails", "streaming", "tracing"],
    limitations: ["Hosted model transport behavior is documented only."],
  },
  {
    id: "autogen",
    displayName: "Microsoft AutoGen",
    packageNames: ["autogen-agentchat", "autogen-core", "microsoft.autogen"],
    commandTokens: ["autogen"],
    frameworkVersionRange: ">=0.4",
    tier: "tier-2",
    evidenceClass: "FIXTURE_BACKED_PROTOCOL",
    integration: "otlp-bridge",
    capabilities: ["OTLP trace/span ingestion", "neutral lifecycle and tool boundaries"],
    limitations: [
      "Only compatible public OTLP output is normalized.",
      "No pinned AutoGen runtime execution is claimed in v0.7.0.",
    ],
  },
  {
    id: "crewai",
    displayName: "CrewAI",
    packageNames: ["crewai"],
    commandTokens: ["crewai", "crew-ai"],
    frameworkVersionRange: ">=0.100",
    tier: "tier-3",
    evidenceClass: "DOCUMENTED_ONLY",
    integration: "callback-events",
    capabilities: ["documented callback/event mapping"],
    limitations: ["No deterministic pinned CrewAI runtime fixture is included in v0.7.0."],
  },
  {
    id: "llamaindex",
    displayName: "LlamaIndex",
    packageNames: ["llama-index", "llama_index"],
    commandTokens: ["llamaindex", "llama-index"],
    frameworkVersionRange: ">=0.12",
    tier: "tier-3",
    evidenceClass: "DOCUMENTED_ONLY",
    integration: "callback-events",
    capabilities: ["documented callback/event mapping"],
    limitations: ["No deterministic pinned LlamaIndex runtime fixture is included in v0.7.0."],
  },
]);

function cloneProfile(profile: FrameworkSupportProfile): FrameworkSupportProfile {
  return {
    ...profile,
    packageNames: [...profile.packageNames],
    commandTokens: [...profile.commandTokens],
    capabilities: [...profile.capabilities],
    limitations: [...profile.limitations],
  };
}

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export class AdapterRegistry {
  private readonly entries = new Map<string, FrameworkSupportProfile>();
  private readonly factories = new Map<string, AdapterFactory>();

  constructor(initialProfiles: readonly FrameworkSupportProfile[] = profiles) {
    for (const profile of initialProfiles) this.registerProfile(profile);
  }

  registerProfile(profile: FrameworkSupportProfile): void {
    const parsed = FrameworkSupportProfileSchema.parse(profile);
    if (this.entries.has(parsed.id))
      throw new Error(`Adapter profile already registered: ${parsed.id}`);
    this.entries.set(parsed.id, cloneProfile(parsed));
  }

  registerFactory(id: string, factory: AdapterFactory): void {
    if (!this.entries.has(id)) throw new Error(`Unknown adapter profile: ${id}`);
    if (this.factories.has(id)) throw new Error(`Adapter factory already registered: ${id}`);
    this.factories.set(id, factory);
  }

  list(): FrameworkSupportProfile[] {
    return [...this.entries.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneProfile);
  }

  resolve(
    context: FrameworkDetectionContext,
    explicitOverride?: string,
  ): FrameworkProfileResolution | undefined {
    if (explicitOverride !== undefined) {
      const profile = this.entries.get(normalized(explicitOverride));
      if (profile === undefined) throw new Error(`Unknown framework override: ${explicitOverride}`);
      return { profile: cloneProfile(profile), source: "explicit-override", matched: profile.id };
    }

    const packageName = normalized(context.packageName);
    if (packageName.length > 0) {
      for (const profile of this.entries.values()) {
        const match = profile.packageNames.find(
          (candidate) => normalized(candidate) === packageName,
        );
        if (match !== undefined) {
          return { profile: cloneProfile(profile), source: "package", matched: match };
        }
      }
    }

    const hint = normalized(context.frameworkHint);
    if (hint.length > 0) {
      for (const profile of this.entries.values()) {
        const tokens = [
          profile.id,
          profile.displayName,
          ...profile.packageNames,
          ...profile.commandTokens,
        ];
        const match = tokens.find((candidate) => hint.includes(normalized(candidate)));
        if (match !== undefined) {
          return { profile: cloneProfile(profile), source: "framework-hint", matched: match };
        }
      }
    }

    const command = normalized(context.command);
    if (command.length > 0) {
      for (const profile of this.entries.values()) {
        const match = [...profile.packageNames, ...profile.commandTokens].find((candidate) =>
          command.includes(normalized(candidate)),
        );
        if (match !== undefined) {
          return { profile: cloneProfile(profile), source: "command", matched: match };
        }
      }
    }
    return undefined;
  }

  create(id: string): FrameworkAdapter {
    const normalizedId = normalized(id);
    if (!this.entries.has(normalizedId)) throw new Error(`Unknown adapter profile: ${id}`);
    const factory = this.factories.get(normalizedId);
    if (factory === undefined) {
      throw new Error(`No runtime adapter factory registered for ${normalizedId}`);
    }
    return factory();
  }

  async doctor(
    id: string,
    context: FrameworkDetectionContext = { rootDirectory: process.cwd() },
  ): Promise<HealthStatus> {
    const normalizedId = normalized(id);
    const profile = this.entries.get(normalizedId);
    if (profile === undefined) return { status: "blocked", messages: [`Unknown framework: ${id}`] };
    const factory = this.factories.get(normalizedId);
    if (factory !== undefined) return factory().doctor(context);
    return {
      status: profile.evidenceClass === "UNSUPPORTED" ? "blocked" : "degraded",
      messages: [
        `${profile.displayName}: ${profile.evidenceClass} via ${profile.integration}.`,
        `No runtime adapter factory is registered in this process.`,
        ...profile.limitations,
      ],
    };
  }
}

export function frameworkSupportProfiles(): FrameworkSupportProfile[] {
  return profiles.map(cloneProfile);
}

export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry();
}

export function detectFrameworkProfile(
  context: FrameworkDetectionContext,
  explicitOverride?: string,
): FrameworkProfileResolution | undefined {
  return createAdapterRegistry().resolve(context, explicitOverride);
}
