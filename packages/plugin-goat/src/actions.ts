import { getOnChainTools } from "@goat-sdk/adapter-vercel-ai";
import { WalletClientBase } from "@goat-sdk/core";
import { worldstore } from "@goat-sdk/plugin-worldstore";
import { crossmintHeadlessCheckout } from "@goat-sdk/plugin-crossmint-headless-checkout";
import { z } from "zod";

import {
    generateText,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    ModelClass,
    type State,
    composeContext,
} from "@elizaos/core";

export async function getOnChainActions(wallet: WalletClientBase) {
    const worldstoreSchema = z.object({
        id: z.string(),
        to: z.string(),
        quantity: z.number(),
        totalPrice: z.string(),
      });


    const tools = await getOnChainTools({
        wallet: wallet,
        plugins: [
            worldstore(),
            crossmintHeadlessCheckout(
                {
                  apiKey:
                    "sk_production_5YV474EEkpYcyzVrUx3TVbEm5fA1mNw4Ejb7UTbAyMEWLhXXEAMVZNrUJegFC4GCxZxu8b7gtqd4jFUs7Rksc3xbqHDAtyS9Sv7EdSshuC2acPsmiVPuDq6XC57nUcZBu5YqsioAWDtvdjmBX5afpECTso35VGRBXSFRJqUYtE7XeFB5um47PHrVsuXimRAvvLuDPyULxXMnAGRk15NabMci",
                },
                worldstoreSchema
            ),
        ],
    });

    const actionsWithoutHandler = Object.entries(tools).map(([key, tool]) => ({
        name: key,
        description: "description" in tool ? tool.description : "",
        similes: [],
        validate: async () => true,
        examples: [],
    }))

    console.log("actionsWithoutHandler", actionsWithoutHandler);



    // 3. Let GOAT handle all the actions
    return actionsWithoutHandler.map((action) => ({
        ...action,
        handler: getActionHandler(action.name, action.description, tools),
    }));
}

function getActionHandler(
    actionName: string,
    actionDescription: string,
    tools
) {
    return async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State | undefined,
        options?: Record<string, unknown>,
        callback?: HandlerCallback
    ): Promise<boolean> => {
        let currentState = state ?? (await runtime.composeState(message));
        currentState = await runtime.updateRecentMessageState(currentState);

        try {
            // 1. Call the tools needed
            const context = composeActionContext(
                actionName,
                actionDescription,
                currentState
            );
            const result = await generateText({
                runtime,
                context,
                tools,
                maxSteps: 10,
                onStepFinish: (step) => {
                    console.log(step.toolResults);
                },
                modelClass: ModelClass.LARGE,
            });

            console.log("result", result);

            // 2. Compose the response
            const response = composeResponseContext(result, currentState);
            const responseText = await generateResponse(runtime, response);

            callback?.({
                text: responseText,
                content: {},
            });
            return true;
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);

            // 3. Compose the error response
            const errorResponse = composeErrorResponseContext(
                errorMessage,
                currentState
            );
            const errorResponseText = await generateResponse(
                runtime,
                errorResponse
            );

            callback?.({
                text: errorResponseText,
                content: { error: errorMessage },
            });
            return false;
        }
    };
}

function composeActionContext(
    actionName: string,
    actionDescription: string,
    state: State
): string {
    const actionTemplate = `
# Knowledge
{{knowledge}}

About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}


# Action: ${actionName}
${actionDescription}

{{recentMessages}}

Based on the action chosen and the previous messages, execute the action and respond to the user using the tools you were given.
`;
    return composeContext({ state, template: actionTemplate });
}

function composeResponseContext(result: unknown, state: State): string {
    const responseTemplate = `
    # Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Knowledge
{{knowledge}}

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

Here is the result:
${JSON.stringify(result)}

{{actions}}

Respond to the message knowing that the action was successful and these were the previous messages:
{{recentMessages}}
  `;
    return composeContext({ state, template: responseTemplate });
}

function composeErrorResponseContext(
    errorMessage: string,
    state: State
): string {
    const errorResponseTemplate = `
# Knowledge
{{knowledge}}

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{actions}}

Respond to the message knowing that the action failed.
The error was:
${errorMessage}

These were the previous messages:
{{recentMessages}}
    `;
    return composeContext({ state, template: errorResponseTemplate });
}

async function generateResponse(
    runtime: IAgentRuntime,
    context: string
): Promise<string> {
    return generateText({
        runtime,
        context,
        modelClass: ModelClass.SMALL,
        maxSteps: 5,
        customSystemPrompt: "You are a friendly and knowledgeable World Store retail assistant. Your goal is to help customers discover and purchase amazing products from around the world. Be enthusiastic, helpful, and always prioritize the customer's needs. Keep responses concise but warm. When buying a product from a store, prefer to use <chain>:<contract_address> as the collection locator. When buying a product from a store, You MUST collect the user's email address and use it as the payment.receiptEmail, and recipient.walletAddress MUST be the user's wallet address. When buying a product from a store, You MUST receive explicit confirmation from the user before you start the checkout process. When buying a product from a store, callData.id should be the id of the product, for example 'RED_BULL_250ML'. After buying a product from a store, the user needs to start a redemption in order to initiate the shipment process. DO NOT collect the user's shipping address before they bought the product."
    });
}
