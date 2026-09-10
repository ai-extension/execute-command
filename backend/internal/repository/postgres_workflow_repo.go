package repository

import (
	"time"

	"github.com/google/uuid"
	"github.com/user/csm-backend/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type PostgresWorkflowRepo struct {
	db *gorm.DB
}

func NewPostgresWorkflowRepo(db *gorm.DB) *PostgresWorkflowRepo {
	return &PostgresWorkflowRepo{db: db}
}

func (r *PostgresWorkflowRepo) Create(wf *domain.Workflow) error {
	return r.db.Create(wf).Error
}

func (r *PostgresWorkflowRepo) GetByID(id uuid.UUID, scope *domain.PermissionScope) (*domain.Workflow, error) {
	var wf domain.Workflow
	db := applyScope(r.db, scope, "workflow_tags", "workflow_id")
	err := db.
		Preload("Inputs", func(db *gorm.DB) *gorm.DB { return db.Order("\"order\" ASC") }).
		Preload("Variables", func(db *gorm.DB) *gorm.DB { return db.Order("\"order\" ASC") }).
		Preload("Outputs", func(db *gorm.DB) *gorm.DB { return db.Order("\"order\" ASC") }).
		Preload("DefaultServer").
		Preload("Groups", func(db *gorm.DB) *gorm.DB { return db.Order("\"order\" ASC") }).
		Preload("Groups.DefaultServer").
		Preload("Groups.CopyTargetServer").
		Preload("Groups.Steps", func(db *gorm.DB) *gorm.DB { return db.Order("\"order\" ASC") }).
		Preload("Hooks", func(db *gorm.DB) *gorm.DB { return db.Order("\"order\" ASC") }).
		Preload("Hooks.TargetWorkflow").
		Preload("Files").
		Preload("Tags").
		Take(&wf, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &wf, nil
}

func (r *PostgresWorkflowRepo) List(namespaceID uuid.UUID, scope *domain.PermissionScope) ([]domain.Workflow, error) {
	var wfs []domain.Workflow
	db := applyScope(r.db, scope, "workflow_tags", "workflow_id")
	err := db.
		Select(`workflows.*, 
            (SELECT COUNT(id) FROM workflow_groups WHERE workflow_id = workflows.id) as group_count, 
            (SELECT COUNT(workflow_steps.id) FROM workflow_steps INNER JOIN workflow_groups ON workflow_groups.id = workflow_steps.group_id WHERE workflow_groups.workflow_id = workflows.id) as step_count`).
		Preload("Inputs", func(db *gorm.DB) *gorm.DB { return db.Order("\"order\" ASC") }).
		Preload("DefaultServer").
		Preload("Tags").
		Where("namespace_id = ?", namespaceID).
		Order("workflows.created_at DESC").
		Find(&wfs).Error
	if err != nil {
		return nil, err
	}
	return wfs, nil
}

func (r *PostgresWorkflowRepo) ListPaginated(namespaceID uuid.UUID, limit, offset int, searchTerm string, tagIDs []uuid.UUID, isTemplate *bool, isPublic *bool, createdBy *uuid.UUID, scope *domain.PermissionScope) ([]domain.Workflow, int64, error) {
	var wfs []domain.Workflow
	var total int64

	db := applyScope(r.db, scope, "workflow_tags", "workflow_id")
	db = db.Model(&domain.Workflow{}).Where("namespace_id = ?", namespaceID)

	if isTemplate != nil {
		db = db.Where("is_template = ?", *isTemplate)
	}

	if isPublic != nil {
		db = db.Where("is_public = ?", *isPublic)
	}

	if createdBy != nil {
		db = db.Where("created_by = ?", createdBy)
	}

	if searchTerm != "" {
		db = db.Where("name ILIKE ? OR description ILIKE ?", "%"+searchTerm+"%", "%"+searchTerm+"%")
	}

	if len(tagIDs) > 0 {
		db = db.Where("id IN (SELECT workflow_id FROM workflow_tags WHERE tag_id IN ?)", tagIDs)
	}

	// Count total
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Fetch paginated
	err := db.
		Select(`workflows.*, 
            (SELECT COUNT(id) FROM workflow_groups WHERE workflow_id = workflows.id) as group_count, 
            (SELECT COUNT(workflow_steps.id) FROM workflow_steps INNER JOIN workflow_groups ON workflow_groups.id = workflow_steps.group_id WHERE workflow_groups.workflow_id = workflows.id) as step_count`).
		Preload("Inputs", func(db *gorm.DB) *gorm.DB { return db.Order("\"order\" ASC") }).
		Preload("DefaultServer").
		Preload("Tags").
		Order("workflows.created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&wfs).Error

	return wfs, total, err
}

func (r *PostgresWorkflowRepo) ListGlobalPaginated(limit, offset int, searchTerm string, tagIDs []uuid.UUID, isTemplate *bool, scope *domain.PermissionScope) ([]domain.Workflow, int64, error) {
	var wfs []domain.Workflow
	var total int64

	db := applyScope(r.db, scope, "workflow_tags", "workflow_id")
	db = db.Model(&domain.Workflow{})

	if isTemplate != nil {
		db = db.Where("is_template = ?", *isTemplate)
	}

	if searchTerm != "" {
		db = db.Where("name ILIKE ? OR description ILIKE ?", "%"+searchTerm+"%", "%"+searchTerm+"%")
	}

	if len(tagIDs) > 0 {
		db = db.Where("id IN (SELECT workflow_id FROM workflow_tags WHERE tag_id IN ?)", tagIDs)
	}

	// Count total
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Fetch paginated
	err := db.
		Select(`workflows.*, 
            (SELECT COUNT(id) FROM workflow_groups WHERE workflow_id = workflows.id) as group_count, 
            (SELECT COUNT(workflow_steps.id) FROM workflow_steps INNER JOIN workflow_groups ON workflow_groups.id = workflow_steps.group_id WHERE workflow_groups.workflow_id = workflows.id) as step_count`).
		Preload("Inputs", func(db *gorm.DB) *gorm.DB { return db.Order("\"order\" ASC") }).
		Preload("DefaultServer").
		Preload("Tags").
		Order("workflows.created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&wfs).Error

	return wfs, total, err
}

func (r *PostgresWorkflowRepo) UpdateStatus(id uuid.UUID, status domain.Status) error {
	return r.db.Model(&domain.Workflow{}).Where("id = ?", id).Update("status", status).Error
}

func (r *PostgresWorkflowRepo) Update(wf *domain.Workflow) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Sync Inputs
		if wf.Inputs != nil {
			for i := range wf.Inputs {
				if wf.Inputs[i].ID == uuid.Nil {
					wf.Inputs[i].ID = uuid.New()
				}
				wf.Inputs[i].WorkflowID = wf.ID
				if wf.Inputs[i].Type == "" {
					wf.Inputs[i].Type = "input"
				}
				if err := tx.Save(&wf.Inputs[i]).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(wf).Association("Inputs").Replace(wf.Inputs); err != nil {
				return err
			}
		}

		// Sync Variables
		if wf.Variables != nil {
			for i := range wf.Variables {
				if wf.Variables[i].ID == uuid.Nil {
					wf.Variables[i].ID = uuid.New()
				}
				wf.Variables[i].WorkflowID = wf.ID
				if err := tx.Save(&wf.Variables[i]).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(wf).Association("Variables").Replace(wf.Variables); err != nil {
				return err
			}
		}

		// Sync Outputs
		if wf.Outputs != nil {
			for i := range wf.Outputs {
				if wf.Outputs[i].ID == uuid.Nil {
					wf.Outputs[i].ID = uuid.New()
				}
				wf.Outputs[i].WorkflowID = wf.ID
				if err := tx.Save(&wf.Outputs[i]).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(wf).Association("Outputs").Replace(wf.Outputs); err != nil {
				return err
			}
		}

		// Sync Groups & Steps
		if wf.Groups != nil {
			// Step 1: Upsert each group first to ensure it exists in the DB before touching steps.
			for i := range wf.Groups {
				wf.Groups[i].WorkflowID = wf.ID
				if err := tx.Omit(clause.Associations).Save(&wf.Groups[i]).Error; err != nil {
					return err
				}
			}

			// Step 2: Handle steps for each group
			for i := range wf.Groups {
				for j := range wf.Groups[i].Steps {
					if wf.Groups[i].Steps[j].ID == uuid.Nil {
						wf.Groups[i].Steps[j].ID = uuid.New()
					}
					wf.Groups[i].Steps[j].GroupID = wf.Groups[i].ID
					if wf.Groups[i].Steps[j].ActionType == "" {
						wf.Groups[i].Steps[j].ActionType = "COMMAND"
					}
					if err := tx.Omit(clause.Associations).Save(&wf.Groups[i].Steps[j]).Error; err != nil {
						return err
					}
				}
				// Sync steps within this group
				if err := tx.Model(&wf.Groups[i]).Association("Steps").Replace(wf.Groups[i].Steps); err != nil {
					return err
				}
			}

			// Step 3: Sync the workflow's group collection
			if err := tx.Model(wf).Association("Groups").Replace(wf.Groups); err != nil {
				return err
			}
		}

		// Sync Hooks
		if wf.Hooks != nil {
			for i := range wf.Hooks {
				if wf.Hooks[i].ID == uuid.Nil {
					wf.Hooks[i].ID = uuid.New()
				}
				wf.Hooks[i].WorkflowID = &wf.ID
				if err := tx.Omit(clause.Associations).Save(&wf.Hooks[i]).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(wf).Association("Hooks").Replace(wf.Hooks); err != nil {
				return err
			}
		}

		// Sync Tags
		if wf.Tags != nil {
			if err := tx.Model(wf).Association("Tags").Replace(wf.Tags); err != nil {
				return err
			}
		}

		// Sync Files
		if wf.Files != nil {
			for i := range wf.Files {
				if wf.Files[i].ID == uuid.Nil {
					wf.Files[i].ID = uuid.New()
				}
				wf.Files[i].WorkflowID = wf.ID
				if err := tx.Omit(clause.Associations).Save(&wf.Files[i]).Error; err != nil {
					return err
				}
			}
			if err := tx.Model(wf).Association("Files").Replace(wf.Files); err != nil {
				return err
			}
		}

		// Update top-level fields (omit associations to avoid double-processing)
		return tx.Omit(clause.Associations).Save(wf).Error
	})
}

func (r *PostgresWorkflowRepo) Delete(id uuid.UUID) error {
	return r.db.Delete(&domain.Workflow{}, "id = ?", id).Error
}

type PostgresWorkflowGroupRepo struct {
	db *gorm.DB
}

func NewPostgresWorkflowGroupRepo(db *gorm.DB) *PostgresWorkflowGroupRepo {
	return &PostgresWorkflowGroupRepo{db: db}
}

func (r *PostgresWorkflowGroupRepo) Create(group *domain.WorkflowGroup) error {
	return r.db.Create(group).Error
}

func (r *PostgresWorkflowGroupRepo) GetByWorkflowID(workflowID uuid.UUID) ([]domain.WorkflowGroup, error) {
	var groups []domain.WorkflowGroup
	if err := r.db.Where("workflow_id = ?", workflowID).Order("\"order\" ASC").Find(&groups).Error; err != nil {
		return nil, err
	}
	return groups, nil
}

func (r *PostgresWorkflowGroupRepo) Update(group *domain.WorkflowGroup) error {
	return r.db.Save(group).Error
}

func (r *PostgresWorkflowGroupRepo) UpdateStatus(id uuid.UUID, status domain.Status) error {
	return r.db.Model(&domain.WorkflowGroup{}).Where("id = ?", id).Update("status", status).Error
}

func (r *PostgresWorkflowGroupRepo) Delete(id uuid.UUID) error {
	return r.db.Delete(&domain.WorkflowGroup{}, "id = ?", id).Error
}

type PostgresWorkflowStepRepo struct {
	db *gorm.DB
}

func NewPostgresWorkflowStepRepo(db *gorm.DB) *PostgresWorkflowStepRepo {
	return &PostgresWorkflowStepRepo{db: db}
}

func (r *PostgresWorkflowStepRepo) Create(step *domain.WorkflowStep) error {
	return r.db.Create(step).Error
}

func (r *PostgresWorkflowStepRepo) GetByGroupID(groupID uuid.UUID) ([]domain.WorkflowStep, error) {
	var steps []domain.WorkflowStep
	if err := r.db.Where("group_id = ?", groupID).Order("\"order\" ASC").Find(&steps).Error; err != nil {
		return nil, err
	}
	return steps, nil
}

func (r *PostgresWorkflowStepRepo) Update(step *domain.WorkflowStep) error {
	return r.db.Save(step).Error
}

func (r *PostgresWorkflowStepRepo) Delete(id uuid.UUID) error {
	return r.db.Delete(&domain.WorkflowStep{}, "id = ?", id).Error
}

type PostgresWorkflowInputRepo struct {
	db *gorm.DB
}

func NewPostgresWorkflowInputRepo(db *gorm.DB) *PostgresWorkflowInputRepo {
	return &PostgresWorkflowInputRepo{db: db}
}

func (r *PostgresWorkflowInputRepo) Create(input *domain.WorkflowInput) error {
	return r.db.Create(input).Error
}

func (r *PostgresWorkflowInputRepo) GetByWorkflowID(workflowID uuid.UUID) ([]domain.WorkflowInput, error) {
	var inputs []domain.WorkflowInput
	if err := r.db.Where("workflow_id = ?", workflowID).Order("\"order\" ASC").Find(&inputs).Error; err != nil {
		return nil, err
	}
	return inputs, nil
}

func (r *PostgresWorkflowInputRepo) Update(input *domain.WorkflowInput) error {
	return r.db.Save(input).Error
}

func (r *PostgresWorkflowInputRepo) Delete(id uuid.UUID) error {
	return r.db.Delete(&domain.WorkflowInput{}, "id = ?", id).Error
}

type PostgresWorkflowVariableRepo struct {
	db *gorm.DB
}

func NewPostgresWorkflowVariableRepo(db *gorm.DB) *PostgresWorkflowVariableRepo {
	return &PostgresWorkflowVariableRepo{db: db}
}

func (r *PostgresWorkflowVariableRepo) Create(variable *domain.WorkflowVariable) error {
	return r.db.Create(variable).Error
}

func (r *PostgresWorkflowVariableRepo) GetByWorkflowID(workflowID uuid.UUID) ([]domain.WorkflowVariable, error) {
	var variables []domain.WorkflowVariable
	if err := r.db.Where("workflow_id = ?", workflowID).Order("\"order\" ASC").Find(&variables).Error; err != nil {
		return nil, err
	}
	return variables, nil
}

func (r *PostgresWorkflowVariableRepo) Update(variable *domain.WorkflowVariable) error {
	return r.db.Save(variable).Error
}

func (r *PostgresWorkflowVariableRepo) Delete(id uuid.UUID) error {
	return r.db.Delete(&domain.WorkflowVariable{}, "id = ?", id).Error
}

type PostgresWorkflowExecutionRepo struct {
	db *gorm.DB
}

func NewPostgresWorkflowExecutionRepo(db *gorm.DB) *PostgresWorkflowExecutionRepo {
	return &PostgresWorkflowExecutionRepo{db: db}
}

func (r *PostgresWorkflowExecutionRepo) Create(exec *domain.WorkflowExecution) error {
	return r.db.Create(exec).Error
}

func (r *PostgresWorkflowExecutionRepo) GetByID(id uuid.UUID, scope *domain.PermissionScope) (*domain.WorkflowExecution, error) {
	var exec domain.WorkflowExecution
	db := r.db
	if scope != nil && !scope.IsGlobal {
		db = db.Joins("JOIN workflows ON workflows.id = workflow_executions.workflow_id")
		cond := r.db.Where("workflows.namespace_id IN ?", scope.AllowedNamespaceIDs).
			Or("workflow_executions.workflow_id IN ?", scope.AllowedItemIDs)
		if len(scope.AllowedTagIDs) > 0 {
			sub := r.db.Table("workflow_tags").Select("workflow_id").Where("tag_id IN ?", scope.AllowedTagIDs)
			cond = cond.Or("workflow_executions.workflow_id IN (?)", sub)
		}
		db = db.Where(cond)
	}
	if err := db.Preload("User").Preload("Workflow.Groups.Steps").Preload("Steps").Take(&exec, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &exec, nil
}

func (r *PostgresWorkflowExecutionRepo) ListByWorkflowID(workflowID uuid.UUID, scope *domain.PermissionScope) ([]domain.WorkflowExecution, error) {
	var execs []domain.WorkflowExecution
	db := r.db
	if scope != nil && !scope.IsGlobal {
		rbacCond := r.db.Where("workflows.namespace_id IN ? OR workflow_executions.workflow_id IN ?", scope.AllowedNamespaceIDs, scope.AllowedItemIDs)
		if len(scope.AllowedTagIDs) > 0 {
			rbacCond = rbacCond.Or("workflow_executions.workflow_id IN (SELECT workflow_id FROM workflow_tags WHERE tag_id IN ?)", scope.AllowedTagIDs)
		}
		db = db.Joins("JOIN workflows ON workflows.id = workflow_executions.workflow_id").Where(rbacCond)
	}
	if err := db.Where("workflow_id = ?", workflowID).Order("created_at DESC").Find(&execs).Error; err != nil {
		return nil, err
	}
	return execs, nil
}

func (r *PostgresWorkflowExecutionRepo) ListByWorkflowIDPaginated(workflowID uuid.UUID, limit, offset int, executedBy *uuid.UUID, tagIDs []uuid.UUID, scope *domain.PermissionScope) ([]domain.WorkflowExecution, int64, error) {
	var execs []domain.WorkflowExecution
	var total int64

	db := r.db.Model(&domain.WorkflowExecution{}).
		Joins("JOIN workflows ON workflows.id = workflow_executions.workflow_id").
		Where("workflow_executions.workflow_id = ?", workflowID)

	if scope != nil && !scope.IsGlobal {
		rbacCond := r.db.Where("workflows.namespace_id IN ? OR workflow_executions.workflow_id IN ?", scope.AllowedNamespaceIDs, scope.AllowedItemIDs)
		if len(scope.AllowedTagIDs) > 0 {
			rbacCond = rbacCond.Or("workflow_executions.workflow_id IN (SELECT workflow_id FROM workflow_tags WHERE tag_id IN ?)", scope.AllowedTagIDs)
		}
		db = db.Where(rbacCond)
	}

	if executedBy != nil {
		db = db.Where("workflow_executions.executed_by = ?", executedBy)
	}

	if len(tagIDs) > 0 {
		db = db.Where("workflow_executions.workflow_id IN (SELECT workflow_id FROM workflow_tags WHERE tag_id IN ?)", tagIDs)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err := db.Preload("User").
		Preload("Schedule").
		Order("workflow_executions.created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&execs).Error
	return execs, total, err
}

func (r *PostgresWorkflowExecutionRepo) ListByNamespaceID(namespaceID uuid.UUID, scope *domain.PermissionScope) ([]domain.WorkflowExecution, error) {
	var execs []domain.WorkflowExecution
	db := r.db
	if scope != nil && !scope.IsGlobal {
		db = db.Joins("JOIN workflows ON workflows.id = workflow_executions.workflow_id").
			Where("workflows.namespace_id IN ? OR workflow_executions.workflow_id IN ?", scope.AllowedNamespaceIDs, scope.AllowedItemIDs)
	}
	err := db.
		Preload("User").
		Preload("Workflow").
		Joins("JOIN workflows w2 ON w2.id = workflow_executions.workflow_id").
		Where("w2.namespace_id = ?", namespaceID).
		Order("workflow_executions.created_at DESC").
		Find(&execs).Error
	if err != nil {
		return nil, err
	}
	return execs, nil
}

func (r *PostgresWorkflowExecutionRepo) ListByNamespaceIDPaginated(namespaceID uuid.UUID, limit, offset int, status string, workflowID *uuid.UUID, executedBy *uuid.UUID, tagIDs []uuid.UUID, scope *domain.PermissionScope) ([]domain.WorkflowExecution, int64, error) {
	var execs []domain.WorkflowExecution
	var total int64
	db := r.db.Model(&domain.WorkflowExecution{}).
		Joins("JOIN workflows w2 ON w2.id = workflow_executions.workflow_id").
		Where("w2.namespace_id = ?", namespaceID).
		// Only paginate/count top-level (parent) executions. Sub-workflow / hook
		// child executions are pulled in separately below and nested on the FE,
		// so they no longer eat page slots or inflate the total.
		Where("workflow_executions.parent_execution_id IS NULL")

	if scope != nil && !scope.IsGlobal {
		rbacCond := r.db.Where("w2.namespace_id IN ? OR workflow_executions.workflow_id IN ?", scope.AllowedNamespaceIDs, scope.AllowedItemIDs)
		if len(scope.AllowedTagIDs) > 0 {
			rbacCond = rbacCond.Or("workflow_executions.workflow_id IN (SELECT workflow_id FROM workflow_tags WHERE tag_id IN ?)", scope.AllowedTagIDs)
		}
		db = db.Where(rbacCond)
	}

	if status != "" && status != "ALL" {
		db = db.Where("workflow_executions.status = ?", status)
	}

	if workflowID != nil {
		db = db.Where("workflow_executions.workflow_id = ?", workflowID)
	}

	if executedBy != nil {
		db = db.Where("workflow_executions.executed_by = ?", executedBy)
	}

	if len(tagIDs) > 0 {
		db = db.Where("workflow_executions.workflow_id IN (SELECT workflow_id FROM workflow_tags WHERE tag_id IN ?)", tagIDs)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if err := db.Preload("User").Preload("Workflow").Preload("Schedule").Preload("Page").
		Order("workflow_executions.created_at DESC").
		Limit(limit).Offset(offset).Find(&execs).Error; err != nil {
		return nil, 0, err
	}

	// Join the full child subtree for the parent executions on this page so the
	// FE can render them nested. Children are intentionally excluded from `total`.
	parentIDs := make([]uuid.UUID, len(execs))
	for i := range execs {
		parentIDs[i] = execs[i].ID
	}
	children, err := r.loadExecutionDescendants(parentIDs)
	if err != nil {
		return nil, 0, err
	}
	execs = append(execs, children...)

	return execs, total, nil
}

// loadExecutionDescendants returns every execution nested under the given parent
// executions (children, grandchildren, ...). The parent/child graph is a tree
// bounded by the executor's nesting cap (<= 4 levels), so the level-by-level walk
// terminates as soon as a level yields no further children.
func (r *PostgresWorkflowExecutionRepo) loadExecutionDescendants(parentIDs []uuid.UUID) ([]domain.WorkflowExecution, error) {
	var all []domain.WorkflowExecution
	seen := make(map[uuid.UUID]bool)
	current := parentIDs
	for len(current) > 0 {
		var level []domain.WorkflowExecution
		if err := r.db.
			Preload("User").Preload("Workflow").Preload("Schedule").Preload("Page").
			Where("parent_execution_id IN ?", current).
			Order("created_at ASC").
			Find(&level).Error; err != nil {
			return nil, err
		}
		// Guard against duplicate / cyclic data so the walk always terminates even if
		// the parent/child graph isn't a clean tree.
		next := make([]uuid.UUID, 0, len(level))
		for i := range level {
			if seen[level[i].ID] {
				continue
			}
			seen[level[i].ID] = true
			all = append(all, level[i])
			next = append(next, level[i].ID)
		}
		if len(next) == 0 {
			break
		}
		current = next
	}
	return all, nil
}

func (r *PostgresWorkflowExecutionRepo) ListGlobalPaginated(limit, offset int, status string, workflowID *uuid.UUID, executedBy *uuid.UUID, tagIDs []uuid.UUID, scope *domain.PermissionScope) ([]domain.WorkflowExecution, int64, error) {
	var execs []domain.WorkflowExecution
	var total int64
	db := r.db.Model(&domain.WorkflowExecution{}).
		Joins("JOIN workflows w2 ON w2.id = workflow_executions.workflow_id")

	if scope != nil && !scope.IsGlobal {
		rbacCond := r.db.Where("w2.namespace_id IN ? OR workflow_executions.workflow_id IN ?", scope.AllowedNamespaceIDs, scope.AllowedItemIDs)
		if len(scope.AllowedTagIDs) > 0 {
			rbacCond = rbacCond.Or("workflow_executions.workflow_id IN (SELECT workflow_id FROM workflow_tags WHERE tag_id IN ?)", scope.AllowedTagIDs)
		}
		db = db.Where(rbacCond)
	}

	if status != "" && status != "ALL" {
		db = db.Where("workflow_executions.status = ?", status)
	}

	if workflowID != nil {
		db = db.Where("workflow_executions.workflow_id = ?", workflowID)
	}

	if executedBy != nil {
		db = db.Where("workflow_executions.executed_by = ?", executedBy)
	}

	if len(tagIDs) > 0 {
		db = db.Where("workflow_executions.workflow_id IN (SELECT workflow_id FROM workflow_tags WHERE tag_id IN ?)", tagIDs)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err := db.Preload("User").Preload("Workflow").Preload("Schedule").Preload("Page").
		Order("workflow_executions.created_at DESC").
		Limit(limit).Offset(offset).Find(&execs).Error
	return execs, total, err
}

func (r *PostgresWorkflowExecutionRepo) ListByScheduledID(scheduledID uuid.UUID, scope *domain.PermissionScope) ([]domain.WorkflowExecution, error) {
	var execs []domain.WorkflowExecution
	db := r.db
	if scope != nil && !scope.IsGlobal {
		db = db.Joins("JOIN workflows ON workflows.id = workflow_executions.workflow_id").
			Where("workflows.namespace_id IN ? OR workflow_executions.workflow_id IN ?", scope.AllowedNamespaceIDs, scope.AllowedItemIDs)
	}
	err := db.
		Preload("User").Preload("Workflow").Preload("Page").
		Where("scheduled_id = ?", scheduledID).
		Order("created_at DESC").
		Find(&execs).Error
	return execs, err
}

func (r *PostgresWorkflowExecutionRepo) Update(exec *domain.WorkflowExecution) error {
	return r.db.Omit(clause.Associations).Save(exec).Error
}

func (r *PostgresWorkflowExecutionRepo) CreateStepResult(stepExec *domain.WorkflowExecutionStep) error {
	return r.db.Omit(clause.Associations).Save(stepExec).Error // Use Save to handle both Create and Update
}

func (r *PostgresWorkflowExecutionRepo) GetExecutionAnalytics(namespaceID uuid.UUID, days int, scope *domain.PermissionScope) ([]map[string]interface{}, error) {
	var results []map[string]interface{}

	startDate := time.Now().AddDate(0, 0, -days)

	db := r.db.Table("workflow_executions").
		Select("DATE(workflow_executions.created_at) as date, COUNT(CASE WHEN workflow_executions.status = 'SUCCESS' THEN 1 END) as success, COUNT(CASE WHEN workflow_executions.status = 'FAILED' THEN 1 END) as failed").
		Joins("JOIN workflows ON workflows.id = workflow_executions.workflow_id").
		Where("workflows.namespace_id = ?", namespaceID).
		Where("workflow_executions.created_at >= ?", startDate)

	if scope != nil && !scope.IsGlobal {
		db = db.Where("workflows.namespace_id IN ? OR workflow_executions.workflow_id IN ?", scope.AllowedNamespaceIDs, scope.AllowedItemIDs)
	}

	err := db.Group("DATE(workflow_executions.created_at)").
		Order("date ASC").
		Scan(&results).Error

	return results, err
}

func (r *PostgresWorkflowExecutionRepo) CleanupInterruptedExecutions() error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		interruptedMsg := "\n[SYSTEM] Execution interrupted due to server restart."

		// Update running steps first
		if err := tx.Model(&domain.WorkflowExecutionStep{}).
			Where("status = ?", domain.StatusRunning).
			Updates(map[string]interface{}{
				"status":      domain.StatusFailed,
				"finished_at": &now,
				"output":      gorm.Expr("output || ?", interruptedMsg),
			}).Error; err != nil {
			return err
		}

		// Update running executions
		if err := tx.Model(&domain.WorkflowExecution{}).
			Where("status = ?", domain.StatusRunning).
			Updates(map[string]interface{}{
				"status":      domain.StatusFailed,
				"finished_at": &now,
			}).Error; err != nil {
			return err
		}

		// Update template statuses: Workflow and WorkflowGroup
		// These are less critical but keep the UI consistent
		if err := tx.Model(&domain.Workflow{}).
			Where("status = ?", domain.StatusRunning).
			Update("status", domain.StatusFailed).Error; err != nil {
			return err
		}

		return tx.Model(&domain.WorkflowGroup{}).
			Where("status = ?", domain.StatusRunning).
			Update("status", domain.StatusFailed).Error
	})
}

func (r *PostgresWorkflowExecutionRepo) GetRunningExecutions() ([]domain.WorkflowExecution, error) {
	var execs []domain.WorkflowExecution
	err := r.db.Preload("Steps", "status = ?", domain.StatusRunning).
		Where("status = ?", domain.StatusRunning).
		Find(&execs).Error
	return execs, err
}

// GetStatusesByIDs returns only the lightweight status fields for a set of executions
// in a single query. Used by public history reconciliation so the client can resolve
// stale RUNNING entries in one round-trip, without the heavy Preload that GetByID does.
func (r *PostgresWorkflowExecutionRepo) GetStatusesByIDs(ids []uuid.UUID) ([]domain.WorkflowExecution, error) {
	if len(ids) == 0 {
		return []domain.WorkflowExecution{}, nil
	}
	var execs []domain.WorkflowExecution
	err := r.db.
		Select("id", "workflow_id", "status", "finished_at", "executed_by").
		Preload("User").
		Where("id IN ?", ids).
		Find(&execs).Error
	return execs, err
}

// deleteExecutionsBatchSize bounds each cleanup DELETE so a large backlog is drained in
// chunks — keeping memory and lock duration bounded and avoiding Postgres' 65535 bind-
// parameter limit that a single huge `IN (...)` would hit.
const deleteExecutionsBatchSize = 500

// DeleteExecutionsOlderThan hard-deletes executions started before the cutoff, in
// batches. Each batch is a single `DELETE ... RETURNING id` over a LIMITed subquery: it
// physically removes the rows (triggering the ON DELETE CASCADE on steps) and returns
// the deleted IDs so the caller can drop their on-disk log directories. Loops until no
// more rows match.
func (r *PostgresWorkflowExecutionRepo) DeleteExecutionsOlderThan(days int) ([]uuid.UUID, error) {
	if days <= 0 {
		return nil, nil
	}
	cutoff := time.Now().AddDate(0, 0, -days)

	var deleted []uuid.UUID
	for {
		var ids []uuid.UUID
		err := r.db.Raw(`
			DELETE FROM workflow_executions
			WHERE id IN (
				SELECT id FROM workflow_executions
				WHERE started_at < ?
				LIMIT ?
			)
			RETURNING id`, cutoff, deleteExecutionsBatchSize).Scan(&ids).Error
		if err != nil {
			return deleted, err
		}
		if len(ids) == 0 {
			break
		}
		deleted = append(deleted, ids...)
	}
	return deleted, nil
}

func (r *PostgresWorkflowExecutionRepo) GetLatestResult(workflowID uuid.UUID) (*domain.WorkflowExecution, error) {
	var exec domain.WorkflowExecution
	err := r.db.
		Where("workflow_id = ? AND result <> ''", workflowID).
		Order("started_at DESC").
		Take(&exec).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &exec, nil
}
