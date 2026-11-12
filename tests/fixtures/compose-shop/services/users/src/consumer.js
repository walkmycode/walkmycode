// Listens for new orders and notes them against the user.
const { Kafka } = require("kafkajs");

const kafka = new Kafka({ brokers: [process.env.KAFKA_BROKERS ?? "kafka:9092"] });
const consumer = kafka.consumer({ groupId: "users" });

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: "orders.created" });
  await consumer.run({ eachMessage: async ({ message }) => console.log("order", message.value?.toString()) });
}

run().catch(console.error);
