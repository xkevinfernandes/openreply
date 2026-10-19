-- Line tests (stream B2): a test can be a draft, written but not started.
ALTER TYPE "ExperimentStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'RUNNING';
