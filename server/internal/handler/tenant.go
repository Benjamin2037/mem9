package handler

import (
	"net/http"
	"time"
)

type provisionResponse struct {
	ID             string     `json:"id"`
	ClaimURL       string     `json:"claim_url,omitempty"`
	ClaimExpiresAt *time.Time `json:"claim_expires_at,omitempty"`
}

func (s *Server) provisionMem9s(w http.ResponseWriter, r *http.Request) {
	result, err := s.tenant.Provision(r.Context())
	if err != nil {
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusCreated, provisionResponse{
		ID:             result.ID,
		ClaimURL:       result.ClaimURL,
		ClaimExpiresAt: result.ClaimExpiresAt,
	})
}

func (s *Server) getTenantInfo(w http.ResponseWriter, r *http.Request) {
	auth := authInfo(r)

	info, err := s.tenant.GetInfo(r.Context(), auth.TenantID)
	if err != nil {
		s.handleError(w, err)
		return
	}

	respond(w, http.StatusOK, info)
}
