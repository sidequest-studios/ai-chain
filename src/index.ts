import {
  Configuration,
  CreateChatCompletionRequest,
  CreateChatCompletionResponse,
  OpenAIApi,
} from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

export interface MessageTemplate {
  content: string; // A string, or a function that returns
  role?: "user" | "system";
}

export type MessagesTemplate = MessageTemplate[];

export type FunctionLink = Function;

export interface LinkResult {
  name: string;
  result: string;
  chatCompletionResponse?: CreateChatCompletionResponse;
}

export type LinkResults = Record<string, string | object>;

export type ModelLink = Partial<CreateChatCompletionRequest> & {
  name: string;
  retries?: number;
  messagesTemplate?: MessagesTemplate;
  linkResults?: LinkResults;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  model?: string;
};

export type Link = FunctionLink | ModelLink;

export function fillContentTemplate(
  contentTemplate: string,
  linkResults?: any
) {
  if (!linkResults) {
    return contentTemplate;
  }
  const replacedResult = contentTemplate.replace(
    /\{\{([\w\.]+)\}\}/g,
    function (m, key) {
      let parts = key.split(".");
      let value = linkResults;
      for (let part of parts) {
        if (value.hasOwnProperty(part)) {
          value = value[part];
        } else {
          return m;
        }
      }
      return value;
    }
  );
  return replacedResult;
}

export async function getLinkResultOpenAi({
  name,
  retries = 3,
  model = "gpt-3.5-turbo-0613",
  temperature = 0.7,
  messages,
  functions,
  function_call,
  top_p = 1,
  messagesTemplate,
  linkResults,
}: ModelLink): Promise<CreateChatCompletionResponse> {
  let errorToThrow = null;
  while (retries > 0) {
    try {
      // If a template is passed in, replace messages with the generated prompt
      if (messagesTemplate) {
        messages = messagesTemplate.map((messageTemplate) => {
          return {
            role: messageTemplate.role || "user",
            content: fillContentTemplate(messageTemplate.content, linkResults),
          };
        });
      }
      if (!messages) {
        throw new Error("No messages or template provided");
      }
      const chatCompletion = await openai.createChatCompletion({
        model: model,
        temperature: temperature,
        messages: messages,
        top_p: top_p,
        functions,
        function_call,
      });

      return chatCompletion.data;
    } catch (error: any) {
      retries--;
      if (retries === 0) {
        // No retries left, throw error
        if (error.response) {
          console.error(error.response.status);
          console.error(error.response.data);
          throw new Error(error.response.data.error.message);
        } else {
          console.error(error.message);
          throw new Error(error.message);
        }
      }
    }
  }
  // If we reach this point, all retries have been exhausted, so we throw the last captured error
  throw errorToThrow;
}

export const executeLink = async (
  link: Link,
  linkResults: LinkResults,
  retries: number | undefined,
  chain: Link[],
  index: number
): Promise<LinkResult> => {
  let result: string;
  let chatCompletionResponse: CreateChatCompletionResponse | undefined;

  if (link instanceof Function) {
    // If the previous link was a function call (the result is an object, pass the object as arguments)
    if (typeof linkResults[chain[index - 1]?.name] === "object" && index > 0) {
      // @ts-ignore
      result = await link({ ...linkResults[chain[index - 1].name] });
    } else {
      // Otherwise just pass in all of the previous link results
      result = await link({ ...linkResults });
    }
  } else {
    chatCompletionResponse = await getLinkResultOpenAi({
      ...link,
      linkResults,
      retries,
    });
    // If function call
    if (chatCompletionResponse.choices[0].message.function_call) {
      result = JSON.parse(
        chatCompletionResponse.choices[0].message.function_call.arguments
      );
    } else {
      // Regular message
      result = chatCompletionResponse.choices[0].message?.content || "";
    }
  }

  if (!result) {
    throw new Error(`Execution failed for link ${link.name}`);
  }

  return {
    name: link.name,
    result,
    chatCompletionResponse,
  };
};

export interface ExecuteChainResult {
  finalResult: string | object;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  chatCompletionResponses: Record<string, CreateChatCompletionResponse>;
  linkResults: LinkResults;
}

export interface ExecuteChainConfig {
  retries: number;
}

export async function executeChain(
  chain: Link[],
  config?: ExecuteChainConfig
): Promise<ExecuteChainResult> {
  const linkResults: LinkResults = {};
  const chatCompletionResponses: Record<string, CreateChatCompletionResponse> =
    {};

  for (let i = 0; i < chain.length; i++) {
    const { name, result, chatCompletionResponse } = await executeLink(
      chain[i],
      linkResults,
      config?.retries,
      chain,
      i
    );
    linkResults[name] = result;
    if (chatCompletionResponse) {
      chatCompletionResponses[name] = chatCompletionResponse;
    }
  }

  const finalResult = linkResults[chain[chain.length - 1].name];
  const totalPromptTokens = Object.values(chatCompletionResponses).reduce(
    (acc, curr) => acc + (curr.usage?.prompt_tokens || 0),
    0
  );
  const totalCompletionTokens = Object.values(chatCompletionResponses).reduce(
    (acc, curr) => acc + (curr.usage?.completion_tokens || 0),
    0
  );

  const totalTokens = totalPromptTokens + totalCompletionTokens;

  return {
    finalResult,
    totalTokens,
    totalPromptTokens,
    totalCompletionTokens,
    chatCompletionResponses,
    linkResults,
  };
}
