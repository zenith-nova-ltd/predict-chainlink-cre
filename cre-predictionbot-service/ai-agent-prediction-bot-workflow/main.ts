import { cre, decodeJson, type Runtime, type HTTPPayload, Runner } from "@chainlink/cre-sdk";
import { LLMService, type LLMRequestPayload } from './services';

type Config = {
  schedule: string;
  authorizedEVMAddress: string;
  callbackUrl: string;
  openRouterApiKey: string;
  taapiApiKey: string;
};

const onCronTrigger = (runtime: Runtime<Config>): string => {
  runtime.log("Hello world! Workflow triggered.");
  return "Hello world!";
};

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const requestPayload = decodeJson(payload.input) as LLMRequestPayload;
  runtime.log(`Received LLM request for model: ${requestPayload.model}`);

  if (!requestPayload.model || !requestPayload.messages) {
    runtime.log(`Missing required data: model or messages`);
    return JSON.stringify({ error: "Missing required data: model and messages are required" });
  }

  const llmService = new LLMService(runtime.config.openRouterApiKey ?? "");

  // Forward request to LLM
  runtime.log(`Forwarding request to LLM...`);
  const response = llmService.sendRequest(runtime, requestPayload);

  if (!response) {
    runtime.log(`Failed to get response from LLM`);
    return JSON.stringify({ error: "Failed to get response from LLM" });
  }

  runtime.log(`Received response from LLM`);

  // Parse the LLM response
  let parsedResponse: any = null;
  try {
    parsedResponse = JSON.parse(response);
    console.log(parsedResponse);
    if (parsedResponse.trade_decisions) {
      runtime.log(`Received ${parsedResponse.trade_decisions.length} trading decisions`);
      for (const decision of parsedResponse.trade_decisions) {
        runtime.log(`${decision.asset}: ${decision.action} - $${decision.allocation_usd}`);
      }
    }
  } catch {
    // Response might not be JSON, that's okay
    parsedResponse = { raw_response: response };
  }

  // Send response to callback server from config
  const callbackUrl = runtime.config.callbackUrl;
  if (callbackUrl) {
    runtime.log(`Sending response to callback server: ${callbackUrl}`);
    
    const serverResult = llmService.sendToServer(
      runtime,
      callbackUrl,
      {
        llm_response: parsedResponse,
        timestamp: runtime.now().toISOString(),
      }
    );

    if (serverResult.success) {
      runtime.log(`Successfully sent to server`);
    } else {
      runtime.log(`Failed to send to server: ${serverResult.error}`);
    }

    return JSON.stringify({
      llm_response: parsedResponse,
      server_callback: serverResult
    });
  }

  return response;
}

const initWorkflow = (config: Config) => {
  const cronCapability = new cre.capabilities.CronCapability();
  const httpCapability = new cre.capabilities.HTTPCapability();

  return [
    cre.handler(
      cronCapability.trigger({ schedule: config.schedule }), 
      onCronTrigger
    ),
    cre.handler(
      httpCapability.trigger({
        authorizedKeys: [
          {
            type: "KEY_TYPE_ECDSA_EVM",
            publicKey: config.authorizedEVMAddress,
          },
        ],
      }),
      onHttpTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
