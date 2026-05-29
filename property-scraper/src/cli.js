"use strict";

require("dotenv").config();
const { migrate } = require("./migrate");
const { runResync } = require("./resync");
const { importFromFile } = require("./importer");
const { close } = require("./db");

function usage() {
  console.log(`Usage: node src/cli.js <command>

Commands:
  migrate                       Apply sql/schema.sql to the database.
  import <file> [cities|properties]
                                Bulk import/upsert from a .json or .csv file.
                                JSON object {cities,properties} infers types;
                                a bare array or any CSV needs the type arg.
  resync [limit]                Run a full resync pass (limit overrides RESYNC_LIMIT).
`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "migrate": {
      const r = await migrate();
      console.log(`Migrated. Applied ${r.applied}`);
      break;
    }
    case "import": {
      const file = args[0];
      const type = args[1];
      if (!file) {
        console.error("Error: import requires a file path.");
        usage();
        process.exitCode = 1;
        break;
      }
      const result = await importFromFile(file, type, (msg) =>
        console.log(`[import] ${msg}`)
      );
      console.log(
        `Imported: ${result.cities} cities, ${result.properties} properties.`
      );
      const unmapped = [
        ...result.unmapped.cities,
        ...result.unmapped.properties,
      ];
      if (unmapped.length) {
        console.log(
          `Ignored unmapped columns: ${[...new Set(unmapped)].join(", ")}`
        );
      }
      if (result.errors.length) {
        console.log(`Row errors: ${result.errors.length}`);
        for (const e of result.errors.slice(0, 10)) {
          console.log(`  - [${e.type}] id=${e.id}: ${e.message}`);
        }
        if (result.errors.length > 10) {
          console.log(`  ... and ${result.errors.length - 10} more`);
        }
      }
      break;
    }
    case "resync": {
      const options = {};
      if (args[0] !== undefined) {
        const n = parseInt(args[0], 10);
        options.limit = Number.isNaN(n) || n <= 0 ? null : n;
      }
      const summary = await runResync(options);
      console.log("Resync summary:", JSON.stringify(summary));
      break;
    }
    default:
      usage();
      if (command) process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Error:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await close();
  });
