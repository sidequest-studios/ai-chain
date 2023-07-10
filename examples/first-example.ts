// To test this, install ts-node and run `OPENAI_API_KEY=yourkeyhere ts-node examples/first-example.ts`

import { FunctionLink, ModelLink, executeChain } from "../src";

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
  templates: [
    {
      role: "user",
      contentBlocks: [
        {
          template: `Come up with one first name`,
          include: true,
        },
        {
          template: `that start with the letter {{getRandomletter}}`,
          include: true,
        },
        {
          template: `It should be a really really long name`,
          include: false,
        },
      ],
    },
  ],
};

const getGender: ModelLink = {
  name: "getGender",
  retries: 2,
  model: "gpt-3.5-turbo-0613",
  temperature: 0.9,
  templates: [
    {
      role: "user",
      contentBlocks: `What is the gender of {{getRandomName}}`,
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

const addKunOrChanToName = ({
  gender,
  name,
}: {
  gender: "boy" | "girl";
  name: string;
}) => {
  if (gender === "boy") {
    return `${name}-kun`;
  } else {
    return `${name}-chan`;
  }
};

// Execute the chain
async function example() {
  const result = await executeChain(
    [
      getRandomletter, // Function Link
      getRandomName, // Model Link
      getGender, // Model Link (function calling)
      addKunOrChanToName, // Function Link
    ],
    {
      retries: 3,
    }
  );
  console.log(result);
  return result;
}

example();
