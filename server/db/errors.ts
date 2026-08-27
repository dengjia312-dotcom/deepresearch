export class TaskNotFoundError extends Error {
  constructor() {
    super('Research task was not found.')
    this.name = 'TaskNotFoundError'
  }
}

export class StaleTaskWriteError extends Error {
  constructor() {
    super('The task changed before this result could be saved.')
    this.name = 'StaleTaskWriteError'
  }
}

export class InvalidCitationError extends Error {
  constructor() {
    super('The report contains a citation outside the current task pool.')
    this.name = 'InvalidCitationError'
  }
}

export class TaskOwnershipConflictError extends Error {
  constructor() {
    super('The task id belongs to another anonymous session.')
    this.name = 'TaskOwnershipConflictError'
  }
}
