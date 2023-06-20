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
  const result = await executeChain([
    getRandomletter, // Function Link
    getRandomName, // Model Link
    getGender, // Model Link (function calling)
    addKunOrChanToName, // Function Link
  ]);
  console.log(result);
  return result;
}

example();
