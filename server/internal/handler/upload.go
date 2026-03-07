package handler

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/qiffang/mnemos/server/internal/domain"
)

type uploadResponse struct {
	TaskID string `json:"task_id"`
	Status string `json:"status"`
}

type uploadStatusResponse struct {
	Status     string              `json:"status"`
	Total      int                 `json:"total"`
	Completed  int                 `json:"completed"`
	Failed     int                 `json:"failed,omitempty"`
	Percentage int                 `json:"percentage,omitempty"`
	Tasks      []uploadTaskSummary `json:"tasks,omitempty"`
}

type uploadTaskSummary struct {
	TaskID      string `json:"task_id"`
	FileName    string `json:"file_name"`
	Status      string `json:"status"`
	TotalChunks int    `json:"total_chunks"`
	DoneChunks  int    `json:"done_chunks"`
	Error       string `json:"error,omitempty"`
}

func (s *Server) uploadFile(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		s.handleError(w, &domain.ValidationError{Message: "invalid multipart form: " + err.Error()})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		s.handleError(w, &domain.ValidationError{Field: "file", Message: "file required"})
		return
	}
	defer file.Close()

	agentID := r.FormValue("agent_id")
	sessionID := r.FormValue("session_id")
	fileType := r.FormValue("file_type")
	if fileType != string(domain.FileTypeSession) && fileType != string(domain.FileTypeMemory) {
		s.handleError(w, &domain.ValidationError{Field: "file_type", Message: "must be session or memory"})
		return
	}

	auth := authInfo(r)
	taskID := uuid.New().String()

	uploadDir := filepath.Join(os.TempDir(), "mnemo-uploads", auth.TenantID)
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		s.handleError(w, err)
		return
	}

	fileName := filepath.Base(header.Filename)
	filePath := filepath.Join(uploadDir, fmt.Sprintf("%s-%s", taskID, fileName))
	dst, err := os.Create(filePath)
	if err != nil {
		s.handleError(w, err)
		return
	}
	if _, err := io.Copy(dst, file); err != nil {
		dst.Close()
		_ = os.Remove(filePath)
		s.handleError(w, err)
		return
	}
	if err := dst.Close(); err != nil {
		_ = os.Remove(filePath)
		s.handleError(w, err)
		return
	}

	task := &domain.UploadTask{
		TaskID:      taskID,
		TenantID:    auth.TenantID,
		FileName:    fileName,
		FilePath:    filePath,
		AgentID:     agentID,
		SessionID:   sessionID,
		FileType:    domain.FileType(fileType),
		TotalChunks: 0,
		DoneChunks:  0,
		Status:      domain.TaskPending,
	}
	if err := s.uploadTasks.Create(r.Context(), task); err != nil {
		_ = os.Remove(filePath)
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusAccepted, uploadResponse{TaskID: taskID, Status: string(domain.TaskPending)})
}

func (s *Server) uploadStatus(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)
	tasks, err := s.uploadTasks.ListByTenant(r.Context(), auth.TenantID)
	if err != nil {
		s.handleError(w, err)
		return
	}

	total := len(tasks)
	if total == 0 {
		respond(w, http.StatusOK, map[string]string{"status": "no_tasks"})
		return
	}

	summaries := make([]uploadTaskSummary, 0, total)
	done := 0
	failed := 0
	for _, task := range tasks {
		if task.Status == domain.TaskDone {
			done++
		}
		if task.Status == domain.TaskFailed {
			failed++
		}

		summaries = append(summaries, uploadTaskSummary{
			TaskID:      task.TaskID,
			FileName:    task.FileName,
			Status:      string(task.Status),
			TotalChunks: task.TotalChunks,
			DoneChunks:  task.DoneChunks,
			Error:       task.ErrorMsg,
		})
	}

	percentage := done * 100 / total
	status := "processing"
	response := uploadStatusResponse{
		Status:     status,
		Total:      total,
		Completed:  done,
		Percentage: percentage,
		Tasks:      summaries,
	}

	if failed > 0 {
		response.Status = "partial"
		response.Failed = failed
		respond(w, http.StatusOK, response)
		return
	}

	if done == total {
		respond(w, http.StatusOK, uploadStatusResponse{
			Status:    "done",
			Total:     total,
			Completed: done,
			Tasks:     summaries,
		})
		return
	}

	respond(w, http.StatusOK, response)
}
