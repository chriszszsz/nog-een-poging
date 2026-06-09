import bcrypt from "bcrypt";

const hash = await bcrypt.hash(
  "Welkom123!",
  10
);

console.log(hash);