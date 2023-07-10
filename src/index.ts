import {
  ChatCompletionRequestMessage,
  Configuration,
  CreateChatCompletionRequest,
  CreateChatCompletionResponse,
  OpenAIApi,
} from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

export interface ContentBlock {
  template: string;
  include?: boolean;
}

export type ContentBlocks = ContentBlock[];

export type ContentTemplate = string | ContentBlocks;

export interface MessageTemplate {
  contentBlocks: ContentTemplate;
  role?: "user" | "system";
}

export type Templates = MessageTemplate[];

export type FunctionLink = Function;

export interface LinkResult {
  name: string;
  result: string;
  chatCompletionResponse?: CreateChatCompletionResponse;
  messages: ChatCompletionRequestMessage[];
}

export type LinkResults = Record<string, string | object>;

export type ModelLink = Partial<CreateChatCompletionRequest> & {
  name: string;
  retries?: number;
  templates?: Templates;
  linkResults?: LinkResults;
  autoNewLineContent?: boolean; // defaults to true
  removeDoubleSpaces?: boolean; // defaults to true
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

export function buildContent({
  content,
  linkResults,
  autoNewLineContent = true,
  removeDoubleSpaces = true,
}: {
  content: ContentTemplate;
  linkResults?: LinkResults;
  autoNewLineContent?: boolean;
  removeDoubleSpaces?: boolean;
}) {
  if (typeof content === "string") {
    return fillContentTemplate(content, linkResults);
  }
  // If content is not
  let contentBlocks = content;
  const filledBlocks = contentBlocks
    .filter((block) => block.include !== false)
    .map((contentBlock) => {
      return fillContentTemplate(contentBlock.template, linkResults);
    });
  let result = autoNewLineContent
    ? filledBlocks.join("\n")
    : filledBlocks.join(" ");
  if (removeDoubleSpaces) {
    result = result.replace(/\s\s+/g, " ");
  }
  return result;
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
  templates,
  linkResults,
  autoNewLineContent,
  removeDoubleSpaces,
}: ModelLink): Promise<{
  result: CreateChatCompletionResponse;
  messages: ChatCompletionRequestMessage[];
}> {
  let errorToThrow = null;
  while (retries > 0) {
    try {
      // If a template is passed in, replace messages with the generated prompt
      if (templates) {
        messages = templates.map((messageTemplate) => {
          return {
            role: messageTemplate.role || "user",
            content: buildContent({
              content: messageTemplate.contentBlocks,
              linkResults,
              autoNewLineContent,
              removeDoubleSpaces,
            }),
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

      return { result: chatCompletion.data, messages: messages };
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
  let messages;
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
    const { result: chatCompletionResponse, messages: sentMessages } =
      await getLinkResultOpenAi({
        ...link,
        linkResults,
        retries,
      });
    messages = sentMessages;
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
    messages,
  };
};

export interface ExecuteChainResult {
  finalResult: string | object;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  chatCompletionResponses: Record<string, CreateChatCompletionResponse>;
  linkResults: LinkResults;
  linkMessages: Record<string, ChatCompletionRequestMessage[]>;
}

export interface ExecuteChainConfig {
  retries: number;
}

export async function executeChain(
  chain: Link[],
  config?: ExecuteChainConfig
): Promise<ExecuteChainResult> {
  const linkResults: LinkResults = {};
  const linkMessages: Record<string, ChatCompletionRequestMessage[]> = {};
  const chatCompletionResponses: Record<string, CreateChatCompletionResponse> =
    {};

  for (let i = 0; i < chain.length; i++) {
    const { name, result, chatCompletionResponse, messages } =
      await executeLink(chain[i], linkResults, config?.retries, chain, i);
    linkResults[name] = result;
    linkMessages[name] = messages;
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
    linkMessages,
  };
}
