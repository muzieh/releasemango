import { resolve, basename } from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { generateWorkspace, GenerationError } from "../generator/index.js";
import {
  createBrief,
  inspectStatus,
  renderHuman,
  renderJson,
} from "../inspection/index.js";
import {
  requestHint,
  renderHintHuman,
  renderHintJson,
} from "../hints/index.js";
import {
  evaluateAcceptanceRelease,
  evaluateProductionRelease,
} from "../evaluator/index.js";
import {
  buildReport,
  renderHumanReport,
  serializeReportJson,
} from "../reporting/index.js";
import {
  checkGitSupport,
  createProcessRunner,
  type ProcessRunner,
} from "../git/index.js";
import {
  loadScenario,
  type ScenarioDefinition,
} from "../domain/scenarios/index.js";
import { packageVersion, tutorialAssets } from "./assets.js";
import { diagnostic, line, type CliOutcome } from "./render.js";
import { findWorkspace } from "./workspace.js";

const integer = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new InvalidArgumentError("must be a safe integer");
  return parsed;
};

async function scenario(): Promise<ScenarioDefinition> {
  const result = await loadScenario(tutorialAssets().scenario);
  if (!result.ok) throw new Error("Bundled tutorial scenario is unavailable.");
  return result.value;
}

const jsonMode = (command: Command): boolean =>
  Boolean(command.optsWithGlobals().json);

const trustedProductionRunner = (): ProcessRunner => {
  const runner = createProcessRunner();
  return {
    run: (request) =>
      runner.run({
        ...request,
        args: request.args.map((argument) =>
          argument === "judging/check.mjs"
            ? resolve(tutorialAssets().judgingBundle, argument)
            : argument,
        ),
      }),
  };
};

async function workspaceContext(command: string, json: boolean) {
  const found = await findWorkspace(process.cwd());
  if (!found.ok)
    return { outcome: diagnostic(command, found.code, found.message, json) };
  try {
    return { root: found.root, scenario: await scenario() };
  } catch {
    return {
      outcome: diagnostic(
        command,
        "SCENARIO_UNAVAILABLE",
        "The bundled tutorial scenario is unavailable.",
        json,
        3,
      ),
    };
  }
}

export function createProgram(
  setOutcome: (outcome: CliOutcome) => void,
  signal: AbortSignal,
): Command {
  const program = new Command()
    .name("releasemango")
    .description("Practice release engineering in generated repositories")
    .version(packageVersion())
    .option("--json", "emit one versioned JSON document")
    .exitOverride();
  program.configureOutput({
    writeErr: () => undefined,
    outputError: () => undefined,
  });

  program
    .command("new <scenario> [path]")
    .description("generate a tutorial workspace")
    .option("--seed <integer>", "deterministic seed", integer)
    .option("--overwrite", "replace a matching owned workspace")
    .action(
      async (
        scenarioName: string,
        destination: string | undefined,
        options: { seed?: number; overwrite?: boolean },
        command: Command,
      ) => {
        const json = jsonMode(command);
        if (scenarioName !== "tutorial-01") {
          setOutcome(
            diagnostic(
              "new",
              "SCENARIO_UNKNOWN",
              `Unknown scenario '${scenarioName}'.`,
              json,
            ),
          );
          return;
        }
        const target = resolve(destination ?? "tutorial-01");
        try {
          const support = await checkGitSupport(
            createProcessRunner(),
            process.cwd(),
          );
          if (!support.supported) {
            setOutcome(
              diagnostic("new", "GIT_UNSUPPORTED", support.message, json, 3),
            );
            return;
          }
          const result = await generateWorkspace({
            scenario: await scenario(),
            fixture: tutorialAssets().fixture,
            destination: target,
            generatorVersion: packageVersion(),
            ...(options.seed === undefined ? {} : { seed: options.seed }),
            overwrite: options.overwrite ?? false,
          });
          const display = destination ?? basename(result.destination);
          setOutcome(
            json
              ? {
                  exitCode: 0,
                  stdout: `${JSON.stringify({ schemaVersion: 1, command: "new", ok: true, destination: display, nextAction: `cd ${display}` })}\n`,
                }
              : {
                  exitCode: 0,
                  stdout: `Created ${display}.\nNext action: cd ${display}\n`,
                },
          );
        } catch (error) {
          const usage =
            error instanceof GenerationError && error.phase === "validation";
          setOutcome(
            diagnostic(
              "new",
              usage ? "DESTINATION_UNSAFE" : "GENERATION_FAILED",
              usage ? error.message : "The workspace could not be generated.",
              json,
              usage ? 2 : 3,
            ),
          );
        }
      },
    );

  for (const name of ["brief", "status"] as const)
    program
      .command(name)
      .description(
        name === "brief"
          ? "show the exercise brief"
          : "inspect workspace status",
      )
      .action(async (_options: unknown, command: Command) => {
        const json = jsonMode(command);
        const context = await workspaceContext(name, json);
        if ("outcome" in context) {
          setOutcome(context.outcome);
          return;
        }
        if (name === "brief") {
          const result = createBrief(context.scenario);
          const output = json
            ? renderJson("brief", result)
            : renderHuman("brief", result);
          setOutcome(
            result.ok
              ? { exitCode: 0, stdout: line(output) }
              : diagnostic(
                  name,
                  result.diagnostics[0]?.code ?? "INSPECTION_FAILED",
                  result.diagnostics[0]?.message ?? "Inspection failed.",
                  json,
                  3,
                ),
          );
          return;
        }
        const result = await inspectStatus(context.root);
        const output = json
          ? renderJson("status", result)
          : renderHuman("status", result);
        setOutcome(
          result.ok
            ? { exitCode: 0, stdout: line(output) }
            : diagnostic(
                name,
                result.diagnostics[0]?.code ?? "INSPECTION_FAILED",
                result.diagnostics[0]?.message ?? "Inspection failed.",
                json,
                3,
              ),
        );
      });

  program
    .command("hint")
    .description("show the next non-spoiling hint")
    .action(async (_options: unknown, command: Command) => {
      const json = jsonMode(command);
      const context = await workspaceContext("hint", json);
      if ("outcome" in context) {
        setOutcome(context.outcome);
        return;
      }
      const status = await inspectStatus(context.root);
      if (!status.ok) {
        setOutcome(
          diagnostic(
            "hint",
            status.diagnostics[0]?.code ?? "INSPECTION_FAILED",
            status.diagnostics[0]?.message ?? "Inspection failed.",
            json,
            3,
          ),
        );
        return;
      }
      const result = await requestHint({
        repository: context.root,
        scenario: context.scenario,
        status: status.value,
        report: null,
      });
      if (!result.ok) {
        setOutcome(
          diagnostic(
            "hint",
            result.diagnostics[0]?.code ?? "HINT_FAILED",
            result.diagnostics[0]?.message ?? "Hint failed.",
            json,
            3,
          ),
        );
        return;
      }
      setOutcome({
        exitCode: 0,
        stdout: json
          ? renderHintJson(result.value)
          : renderHintHuman(result.value),
      });
    });

  program
    .command("evaluate <target>")
    .description("evaluate acceptance or production release")
    .action(async (target: string, _options: unknown, command: Command) => {
      const json = jsonMode(command);
      if (target !== "acceptance" && target !== "production") {
        setOutcome(
          diagnostic(
            "evaluate",
            "TARGET_UNKNOWN",
            `Unknown evaluation target '${target}'.`,
            json,
          ),
        );
        return;
      }
      const context = await workspaceContext("evaluate", json);
      if ("outcome" in context) {
        setOutcome(context.outcome);
        return;
      }
      const evaluated =
        target === "acceptance"
          ? await evaluateAcceptanceRelease({
              repository: context.root,
              scenario: context.scenario,
              judgingBundle: tutorialAssets().judgingBundle,
              signal,
            })
          : await evaluateProductionRelease({
              repository: context.root,
              scenario: context.scenario,
              signal,
              runner: trustedProductionRunner(),
            });
      const report = buildReport({
        scoring: context.scenario.scoring,
        release: {
          branch: evaluated.branch,
          baseline: evaluated.baseline,
          tickets: evaluated.tickets,
        },
        evaluation: evaluated,
      });
      const timedOut = evaluated.checks.some(
        ({ evidence }) => evidence.summary === "Process timed out",
      );
      const exitCode =
        evaluated.termination === "cancelled"
          ? 130
          : evaluated.status === "error" || timedOut
            ? 3
            : report.verdict === "pass"
              ? 0
              : 1;
      setOutcome({
        exitCode,
        stdout: json ? serializeReportJson(report) : renderHumanReport(report),
      });
    });
  return program;
}

export async function runProgram(
  argv: readonly string[],
  signal: AbortSignal,
): Promise<CliOutcome> {
  let outcome: CliOutcome | undefined;
  const program = createProgram((value) => {
    outcome = value;
  }, signal);
  try {
    await program.parseAsync([...argv], { from: "user" });
    return outcome ?? { exitCode: 0 };
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
      )
        return { exitCode: 0 };
      const json = argv.includes("--json");
      return diagnostic(
        "cli",
        "CLI_USAGE",
        error.message.replace(/^error: /u, ""),
        json,
      );
    }
    return diagnostic(
      "cli",
      "CLI_FAILURE",
      "The command could not be completed.",
      argv.includes("--json"),
      3,
    );
  }
}
