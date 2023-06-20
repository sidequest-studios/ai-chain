##

Break complex tasks up into small pieces that are easier for LLMs to handle into a chain. Link them with non-ai functions to augment, parse, or validate responses. Function calling supported.

- Aggregates token usage throughout chain
- Automatic retries
- Fully configurable, at both chain and link level

## Install

`npm install llmaochain`

## Example

Start by defining your links. Each link is either a ModelLink or a FunctionLink. ModelLinks are configuration objects that define how to call a model. FunctionLinks are just regular functions.

Templates are a way to build prompts for your model. You can use the results of previous links in your templates with the {{variable}} notation.

```
// Define links
const getRandomletter: FunctionLink = () => {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const randomLetter = letters[Math.floor(Math.random() * letters.length)];
  return randomLetter;
};

const getRandomName: ModelLink = {
  name: "getRandomName",
  model: "gpt-3.5-turbo-0613",
  temperature: 0.9,
  template: [
    {
      content: `Come up with one first name that start with the letter {{getRandomletter}}`,
      include: true,
    },
  ],
};

const getGender: ModelLink = {
  name: "getGender",
  retries: 2,
  model: "gpt-3.5-turbo-0613",
  temperature: 0.9,
  template: [
    {
      content: `What is the gender of {{getRandomName}}`,
      include: true,
    },
  ],
  functions: [
    {
      name: "getGender",
      description: "Gets the gender of a name",
      parameters: {
        type: "object",
        properties: {
          gender: {
            type: "string",
            description: "Either boy or girl",
            enum: ["boy", "girl"],
          },
          name: {
            type: "string",
            description: "The name",
          },
        },
      },
    },
  ],
  function_call: "auto",
};
```

Then, execute the chain. The chain will execute each link in order, passing the results of previous links to the next link. The chain will return the results of the last link.

```
// Execute the chain
async function example() {
  const result = await executeChain([
    getRandomletter, // Function Link
    getRandomName, // Model Link
    getGender, // Model Link (function calling)
    addKunOrChanToName, // Function Link
  ]);
  return result;
}
```

## Output

`executeChain` outputs the following object, so you can easily access the final result and aggregated usage across each link, as well as the results of each link.

```
{
  finalResult: 'Ivan-chan',
  totalTokens: 108,
  totalPromptTokens: 90,
  totalCompletionTokens: 18,
  chatCompletionResponses: {
    getRandomName: {
      id: 'chatcmpl-7TNbk54yIUba6wvtPoT0z5HTNSbMC',
      object: 'chat.completion',
      created: 1687236616,
      model: 'gpt-3.5-turbo-0613',
      choices: [Array],
      usage: [Object]
    },
    getGender: {
      id: 'chatcmpl-7TNbkKZ9n5wmprfpXQL8YNW35CDv0',
      object: 'chat.completion',
      created: 1687236616,
      model: 'gpt-3.5-turbo-0613',
      choices: [Array],
      usage: [Object]
    }
  },
  linkResults: {
    getRandomletter: 'i',
    getRandomName: 'Ivan',
    getGender: { name: 'Ivan' },
    addKunOrChanToName: 'Ivan-chan'
  }
}
```

## Pass results from previous links to a template in a later link

For prompt templates, you can just refer to the name of the previous link in the template. For example, if you want to use the result of the getRandomName link in the template for the getGender link, you can just use the name of the link in the template.

```
{{getRandomName}}
```

If one of your model links outputs JSON through function calling, you can reference a specific value with dot notation

```
{{getGender.gender}}
```

If you are passing the result of a function call directly into a Function Link, you simply define the arguments in that function to match the expected result of the previous link

```
const addKunOrChanToName = ({ gender, name }: {
  gender: "boy" | "girl";
  name: string;
}) => {
  ...
}
```

## Retries

You can pass retries in at each link, or you can pass in a global retry quantity in the executeChain config.

```
  const result = await executeChain(
    [
      getRandomName, // ModelLink
      determineKunOrChan, // FunctionLink
      addKunOrChanToName, // FunctionLink
      writeStoryAboutName, // ModelLink
    ],
    {
      retries: 2,
    }
  );
```
