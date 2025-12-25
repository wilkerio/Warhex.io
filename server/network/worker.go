package network

import (
	"server/game"
)

type WorkerPool struct {
	JobQueue   chan game.Event
	WorkerPool chan chan game.Event
	Workers    []*Worker
	Stop       chan bool
}

type Worker struct {
	ID          int
	JobChannel  chan game.Event
	WorkerPool  chan chan game.Event
	Stop        chan bool
	WorkerGroup *WorkerPool
}

func NewWorkerPool(numWorkers int) *WorkerPool {
	pool := &WorkerPool{
		JobQueue:   make(chan game.Event, 10000),
		WorkerPool: make(chan chan game.Event, numWorkers),
		Stop:       make(chan bool),
	}

	for i := 0; i < numWorkers; i++ {
		worker := &Worker{
			ID:          i,
			JobChannel:  make(chan game.Event),
			WorkerPool:  pool.WorkerPool,
			Stop:        make(chan bool),
			WorkerGroup: pool,
		}
		pool.Workers = append(pool.Workers, worker)
		go worker.Start()
	}

	go pool.Dispatch()

	return pool
}

func (wp *WorkerPool) Dispatch() {
	for {
		select {
		case job := <-wp.JobQueue:
			jobChannel := <-wp.WorkerPool
			jobChannel <- job
		case <-wp.Stop:
			return
		}
	}
}

func (w *Worker) Start() {
	for {
		w.WorkerPool <- w.JobChannel

		select {
		case job := <-w.JobChannel:
			// Handle the job (event)
			handleEvent(job)
		case <-w.Stop:
			return
		}
	}
}

func (wp *WorkerPool) StopAll() {
	for _, worker := range wp.Workers {
		worker.Stop <- true
	}
	wp.Stop <- true
}
