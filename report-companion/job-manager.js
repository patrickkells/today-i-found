import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

function publicJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    error: job.error,
    downloads: job.status === "completed" ? {
      markdown: `/v1/reports/${job.jobId}/download/markdown`,
      json: `/v1/reports/${job.jobId}/download/json`,
    } : undefined,
  };
}

export class ReportJobManager {
  constructor({ pipeline, now = () => new Date() }) {
    this.pipeline = pipeline;
    this.now = now;
    this.jobs = new Map();
    this.activeJobId = null;
  }

  get busy() {
    return Boolean(this.activeJobId);
  }

  start({ edition, items }) {
    if (this.activeJobId) throw Object.assign(new Error("A report is already running"), { statusCode: 409 });
    const jobId = randomUUID();
    const timestamp = this.now().toISOString();
    const controller = new AbortController();
    const job = {
      jobId,
      status: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
      progress: { phase: "queued", completed: 0, total: 1 },
      error: null,
      result: null,
      controller,
    };
    this.jobs.set(jobId, job);
    this.activeJobId = jobId;
    void this.pipeline.run({
      edition,
      items,
      jobId,
      signal: controller.signal,
      onProgress: (progress) => {
        if (!["running", "committing"].includes(job.status)) return;
        job.progress = progress;
        job.updatedAt = this.now().toISOString();
      },
      onCommitStart: () => {
        if (job.status !== "running") return;
        job.status = "committing";
        job.updatedAt = this.now().toISOString();
      },
    }).then((result) => {
      if (job.status === "cancelled") return;
      job.status = "completed";
      job.result = result;
      job.progress = { phase: "completed", completed: 1, total: 1 };
      job.updatedAt = this.now().toISOString();
    }).catch((error) => {
      if (job.status !== "cancelled") {
        job.status = "failed";
        job.error = error?.message || "Report generation failed";
        job.progress = { phase: "failed", completed: 0, total: 1 };
        job.updatedAt = this.now().toISOString();
      }
    }).finally(() => {
      if (this.activeJobId === jobId) this.activeJobId = null;
    });
    return publicJob(job);
  }

  get(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw Object.assign(new Error("Report job was not found"), { statusCode: 404 });
    return publicJob(job);
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw Object.assign(new Error("Report job was not found"), { statusCode: 404 });
    if (job.status !== "running") return false;
    job.status = "cancelled";
    job.error = null;
    job.progress = { phase: "cancelled", completed: 0, total: 1 };
    job.updatedAt = this.now().toISOString();
    job.controller.abort(new Error("Report cancelled"));
    return true;
  }

  async readArtifact(jobId, kind) {
    const job = this.jobs.get(jobId);
    if (!job) throw Object.assign(new Error("Report job was not found"), { statusCode: 404 });
    if (job.status !== "completed") throw Object.assign(new Error("Report artifact is not ready"), { statusCode: 409 });
    const filePath = kind === "markdown" ? job.result.markdownPath : kind === "json" ? job.result.jsonPath : null;
    if (!filePath) throw Object.assign(new Error("Report artifact was not found"), { statusCode: 404 });
    return readFile(filePath);
  }
}
